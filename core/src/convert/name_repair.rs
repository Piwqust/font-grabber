use std::collections::BTreeMap;

use anyhow::{anyhow, Result};

use crate::domain::{FontCandidate, NameDraft};

const CHECKSUM_MAGIC: u32 = 0xB1B0_AFBA;
const REQUIRED_WINDOWS_NAME_IDS: [u16; 6] = [1, 2, 3, 4, 5, 6];
// Macintosh Roman's upper half; Unicode records retain characters outside it.
const MAC_ROMAN: &str = concat!(
    "\u{c4}\u{c5}\u{c7}\u{c9}\u{d1}\u{d6}\u{dc}\u{e1}\u{e0}\u{e2}\u{e4}\u{e3}\u{e5}\u{e7}\u{e9}\u{e8}",
    "\u{ea}\u{eb}\u{ed}\u{ec}\u{ee}\u{ef}\u{f1}\u{f3}\u{f2}\u{f4}\u{f6}\u{f5}\u{fa}\u{f9}\u{fb}\u{fc}",
    "\u{2020}\u{b0}\u{a2}\u{a3}\u{a7}\u{2022}\u{b6}\u{df}\u{ae}\u{a9}\u{2122}\u{b4}\u{a8}\u{2260}\u{c6}\u{d8}",
    "\u{221e}\u{b1}\u{2264}\u{2265}\u{a5}\u{b5}\u{2202}\u{2211}\u{220f}\u{3c0}\u{222b}\u{aa}\u{ba}\u{3a9}\u{e6}\u{f8}",
    "\u{bf}\u{a1}\u{ac}\u{221a}\u{192}\u{2248}\u{2206}\u{ab}\u{bb}\u{2026}\u{a0}\u{c0}\u{c3}\u{d5}\u{152}\u{153}",
    "\u{2013}\u{2014}\u{201c}\u{201d}\u{2018}\u{2019}\u{f7}\u{25ca}\u{ff}\u{178}\u{2044}\u{20ac}\u{2039}\u{203a}\u{fb01}\u{fb02}",
    "\u{2021}\u{b7}\u{201a}\u{201e}\u{2030}\u{c2}\u{ca}\u{c1}\u{cb}\u{c8}\u{cd}\u{ce}\u{cf}\u{cc}\u{d3}\u{d4}",
    "\u{f8ff}\u{d2}\u{da}\u{db}\u{d9}\u{131}\u{2c6}\u{2dc}\u{af}\u{2d8}\u{2d9}\u{2da}\u{b8}\u{2dd}\u{2db}\u{2c7}",
);

#[derive(Clone, Copy)]
struct TableEntry {
    tag: [u8; 4],
    offset: usize,
    length: usize,
}

#[derive(Clone, Copy)]
struct NameRecord {
    platform_id: u16,
    encoding_id: u16,
    language_id: u16,
    name_id: u16,
}

pub fn repair_name_table_if_needed(sfnt_data: &[u8], info: &FontCandidate) -> Result<Vec<u8>> {
    let tables = parse_tables(sfnt_data)?;
    let Some(name_entry) = tables.iter().find(|entry| &entry.tag == b"name") else {
        return Ok(sfnt_data.to_vec());
    };
    let name_table = slice_range(sfnt_data, name_entry.offset, name_entry.length)?;
    if name_table.len() < 6 {
        return Ok(sfnt_data.to_vec());
    }

    let existing = read_name_values(name_table)?;
    if REQUIRED_WINDOWS_NAME_IDS
        .iter()
        .all(|name_id| has_valid_windows_name(name_table, *name_id))
    {
        return Ok(sfnt_data.to_vec());
    }

    // The font's own family/subfamily are authoritative. Foundry CSS often uses
    // anonymous aliases such as "font-style-127"; using those aliases here made
    // otherwise valid fonts install as unrelated one-off families.
    let fallback =
        build_name_replacements(clean_family_name(&info.family), &info.weight, &info.style);
    let family =
        preferred_existing_name(&existing, &[16, 1]).unwrap_or_else(|| fallback[&1].clone());
    let subfamily =
        preferred_existing_name(&existing, &[17, 2]).unwrap_or_else(|| fallback[&2].clone());
    let full_name = preferred_existing_name(&existing, &[4])
        .unwrap_or_else(|| compose_full_name(&family, &subfamily));
    let ps_name = preferred_existing_name(&existing, &[6])
        .unwrap_or_else(|| compose_post_script_name(&family, &subfamily));
    let unique_id = preferred_existing_name(&existing, &[3])
        .unwrap_or_else(|| format!("1.000;Fount;{ps_name}"));
    let version =
        preferred_existing_name(&existing, &[5]).unwrap_or_else(|| "Version 1.000".to_string());
    let replacements = BTreeMap::from([
        (1, family),
        (2, subfamily),
        (3, unique_id),
        (4, full_name),
        (5, version),
        (6, ps_name),
    ]);
    let new_name_table = patch_name_table(name_table, &replacements)?;
    rebuild_sfnt_with_name_table(sfnt_data, &tables, &new_name_table)
}

/// Always write the draft into the name table, including typographic family
/// (ID 16) and subfamily (ID 17) so macOS groups the faces as one family.
pub fn apply_name_draft(sfnt_data: &[u8], draft: &NameDraft) -> Result<Vec<u8>> {
    let tables = parse_tables(sfnt_data)?;
    let name_entry = tables
        .iter()
        .find(|entry| &entry.tag == b"name")
        .ok_or_else(|| anyhow!("Font has no name table"))?;
    let name_table = slice_range(sfnt_data, name_entry.offset, name_entry.length)?;
    anyhow::ensure!(name_table.len() >= 6, "Name table too small");

    let existing = read_name_values(name_table)?;
    if let Some(changes) = &draft.name_changes {
        let mut replacements = changes.clone();
        for (id, legacy_id, fallback) in [(16, 1, "Font"), (17, 2, "Regular")] {
            let value = replacements.get(&legacy_id).cloned().unwrap_or_else(|| {
                preferred_existing_name(&existing, &[id, legacy_id])
                    .unwrap_or_else(|| fallback.to_string())
            });
            replacements.insert(id, value);
        }
        let version = match replacements.get(&5) {
            Some(value) if !value.is_empty() => normalize_version(value)?,
            _ => existing
                .get(&5)
                .cloned()
                .unwrap_or_else(|| "Version 1.000".into()),
        };
        if replacements.get(&5).is_some_and(|v| !v.is_empty()) {
            replacements.insert(5, version.clone());
        }
        let ps = replacements
            .get(&6)
            .or_else(|| existing.get(&6))
            .cloned()
            .unwrap_or_else(|| "Font-Regular".into());
        replacements.insert(
            3,
            format!("{};Fount;{ps}", version.trim_start_matches("Version ")),
        );
        return rewrite_names(sfnt_data, &tables, name_table, &replacements);
    }
    let family = {
        let value = normalize_user_name(&draft.family);
        if value.is_empty() {
            "Font".to_string()
        } else {
            value
        }
    };
    let subfamily = {
        let value = normalize_user_name(&draft.subfamily);
        if value.is_empty() {
            "Regular".to_string()
        } else {
            value
        }
    };
    let full_name = draft
        .full_name
        .as_deref()
        .map(normalize_user_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| compose_full_name(&family, &subfamily));
    let ps_name = draft
        .postscript
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            let mut value = post_script_component(value);
            value.truncate(63);
            if value.is_empty() {
                compose_post_script_name(&family, &subfamily)
            } else {
                value
            }
        })
        .unwrap_or_else(|| compose_post_script_name(&family, &subfamily));
    let version = match draft.version.as_deref() {
        Some("") => String::new(),
        Some(value) => normalize_version(value)?,
        None => preferred_existing_name(&existing, &[5]).unwrap_or_else(|| "Version 1.000".into()),
    };
    let unique_id = format!("{};Fount;{ps_name}", version.trim_start_matches("Version "));
    let mut replacements = BTreeMap::from([
        (1, family.clone()),
        (2, subfamily.clone()),
        (3, unique_id),
        (4, full_name),
        (5, version),
        (6, ps_name),
        (16, family),
        (17, subfamily),
    ]);
    for (id, value) in [
        (0, &draft.copyright),
        (7, &draft.trademark),
        (8, &draft.manufacturer),
        (9, &draft.designer),
        (10, &draft.description),
        (11, &draft.vendor_url),
        (12, &draft.designer_url),
        (13, &draft.license),
        (14, &draft.license_url),
    ] {
        if let Some(value) = value {
            replacements.insert(id, value.clone());
        }
    }
    if draft.version.is_none() {
        replacements.remove(&5);
    }
    rewrite_names(sfnt_data, &tables, name_table, &replacements)
}

pub fn normalize_version(value: &str) -> Result<String> {
    let value = value
        .trim()
        .strip_prefix("Version ")
        .unwrap_or(value.trim());
    let (major, fraction) = value.split_once('.').unwrap_or((value, ""));
    anyhow::ensure!(
        !major.is_empty()
            && major.bytes().all(|b| b.is_ascii_digit())
            && fraction.len() <= 3
            && fraction.bytes().all(|b| b.is_ascii_digit()),
        "Version must be a number such as 1.000"
    );
    let major: u16 = major.parse()?;
    anyhow::ensure!(major <= 32767, "Version is too large");
    Ok(format!("Version {major}.{fraction:0<3}"))
}

fn rewrite_names(
    data: &[u8],
    tables: &[TableEntry],
    names: &[u8],
    changes: &BTreeMap<u16, String>,
) -> Result<Vec<u8>> {
    let patched = patch_name_table(names, changes)?;
    let mut source = data.to_vec();
    if let Some(version) = changes.get(&5).filter(|v| !v.is_empty()) {
        let normalized = normalize_version(version)?;
        let value: f64 = normalized.trim_start_matches("Version ").parse()?;
        if let Some(head) = tables.iter().find(|t| &t.tag == b"head") {
            anyhow::ensure!(head.length >= 12, "Invalid head table");
            write_u32(
                &mut source,
                head.offset + 4,
                (value * 65536.0).round() as u32,
            )?;
        }
    }
    rebuild_sfnt_with_name_table(&source, tables, &patched)
}

pub(super) fn inspect_sfnt_names(data: &[u8]) -> Result<BTreeMap<u16, String>> {
    let tables = parse_tables(data)?;
    let name = tables
        .iter()
        .find(|t| &t.tag == b"name")
        .ok_or_else(|| anyhow!("Font has no name table"))?;
    read_name_values(slice_range(data, name.offset, name.length)?)
}

pub fn subfamily_from_weight_style(weight: &str, style: &str) -> String {
    let is_italic = matches!(style.to_ascii_lowercase().as_str(), "italic" | "oblique");
    let is_bold = weight == "700";
    if is_bold && is_italic {
        "Bold Italic".to_string()
    } else if is_bold {
        "Bold".to_string()
    } else if is_italic {
        "Italic".to_string()
    } else {
        "Regular".to_string()
    }
}

fn normalize_user_name(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn read_name_values(name_table: &[u8]) -> Result<BTreeMap<u16, String>> {
    let count = read_u16(name_table, 2)? as usize;
    let str_offset = read_u16(name_table, 4)? as usize;
    let mut values = BTreeMap::new();

    for index in 0..count {
        let offset = 6 + index * 12;
        if offset + 12 > name_table.len() {
            break;
        }
        let platform_id = read_u16(name_table, offset)?;
        let name_id = read_u16(name_table, offset + 6)?;
        if name_id > 17 {
            continue;
        }
        let length = read_u16(name_table, offset + 8)? as usize;
        let string_offset = read_u16(name_table, offset + 10)? as usize;
        let Some(raw) =
            name_table.get(str_offset + string_offset..str_offset + string_offset + length)
        else {
            continue;
        };
        let value = decode_name_str(raw, platform_id);
        if value.is_empty() {
            continue;
        }

        // Prefer a Windows Unicode record over a Macintosh/legacy record.
        if platform_id == 3 || !values.contains_key(&name_id) {
            values.insert(name_id, value);
        }
    }

    Ok(values)
}

fn has_valid_windows_name(name_table: &[u8], expected_name_id: u16) -> bool {
    let Ok(count) = read_u16(name_table, 2) else {
        return false;
    };
    let Ok(str_offset) = read_u16(name_table, 4) else {
        return false;
    };
    let str_offset = str_offset as usize;

    for index in 0..count as usize {
        let offset = 6 + index * 12;
        let Ok(platform_id) = read_u16(name_table, offset) else {
            continue;
        };
        let Ok(encoding_id) = read_u16(name_table, offset + 2) else {
            continue;
        };
        let Ok(name_id) = read_u16(name_table, offset + 6) else {
            continue;
        };
        if platform_id != 3 || encoding_id != 1 || name_id != expected_name_id {
            continue;
        }
        let Ok(length) = read_u16(name_table, offset + 8) else {
            continue;
        };
        let Ok(string_offset) = read_u16(name_table, offset + 10) else {
            continue;
        };
        let Some(raw) = name_table.get(
            str_offset + string_offset as usize
                ..str_offset + string_offset as usize + length as usize,
        ) else {
            continue;
        };
        if is_valid_font_name(&decode_name_str(raw, platform_id)) {
            return true;
        }
    }

    false
}

fn preferred_existing_name(existing: &BTreeMap<u16, String>, name_ids: &[u16]) -> Option<String> {
    name_ids
        .iter()
        .find_map(|name_id| existing.get(name_id))
        .filter(|value| is_valid_font_name(value))
        .cloned()
}

fn compose_full_name(family: &str, subfamily: &str) -> String {
    if subfamily.eq_ignore_ascii_case("regular") {
        family.to_string()
    } else {
        format!("{family} {subfamily}")
    }
}

fn compose_post_script_name(family: &str, subfamily: &str) -> String {
    let family = post_script_component(family);
    let subfamily = post_script_component(subfamily);
    let mut value = if subfamily.is_empty() {
        family
    } else {
        format!("{family}-{subfamily}")
    };
    value.truncate(63);
    if value.is_empty() {
        "Font-Regular".to_string()
    } else {
        value
    }
}

fn post_script_component(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect()
}

fn parse_tables(sfnt_data: &[u8]) -> Result<Vec<TableEntry>> {
    let num_tables = read_u16(sfnt_data, 4)? as usize;
    let mut tables = Vec::with_capacity(num_tables);
    for index in 0..num_tables {
        let offset = 12 + index * 16;
        if offset + 16 > sfnt_data.len() {
            return Err(anyhow!("Table directory truncated"));
        }

        let tag = [
            sfnt_data[offset],
            sfnt_data[offset + 1],
            sfnt_data[offset + 2],
            sfnt_data[offset + 3],
        ];
        tables.push(TableEntry {
            tag,
            offset: read_u32(sfnt_data, offset + 8)? as usize,
            length: read_u32(sfnt_data, offset + 12)? as usize,
        });
    }
    Ok(tables)
}

fn patch_name_table(name_table: &[u8], replacements: &BTreeMap<u16, String>) -> Result<Vec<u8>> {
    if name_table.len() < 6 {
        return Err(anyhow!("Name table too small"));
    }

    let format = read_u16(name_table, 0)?;
    let count = read_u16(name_table, 2)? as usize;
    let str_offset = read_u16(name_table, 4)? as usize;
    let records_end = 6 + count * 12;
    if str_offset < records_end || str_offset > name_table.len() {
        return Err(anyhow!("Invalid name table string offset"));
    }

    let prefix = name_table[records_end..str_offset].to_vec();
    let mut entries = Vec::with_capacity(count + REQUIRED_WINDOWS_NAME_IDS.len());

    for index in 0..count {
        let offset = 6 + index * 12;
        let record = NameRecord {
            platform_id: read_u16(name_table, offset)?,
            encoding_id: read_u16(name_table, offset + 2)?,
            language_id: read_u16(name_table, offset + 4)?,
            name_id: read_u16(name_table, offset + 6)?,
        };
        let length = read_u16(name_table, offset + 8)? as usize;
        let string_offset = read_u16(name_table, offset + 10)? as usize;
        let raw = name_table
            .get(str_offset + string_offset..str_offset + string_offset + length)
            .unwrap_or_default();
        match replacements.get(&record.name_id) {
            Some(value) if value.is_empty() => continue,
            Some(value) => entries.push((record, encode_name_str(value, record.platform_id))),
            None => entries.push((record, raw.to_vec())),
        }
    }

    for (&name_id, value) in replacements {
        if value.is_empty() {
            continue;
        }
        for (platform_id, encoding_id, language_id) in [(3, 1, 0x0409), (1, 0, 0)] {
            if !entries.iter().any(|(r, _)| {
                r.platform_id == platform_id
                    && r.encoding_id == encoding_id
                    && r.language_id == language_id
                    && r.name_id == name_id
            }) {
                entries.push((
                    NameRecord {
                        platform_id,
                        encoding_id,
                        language_id,
                        name_id,
                    },
                    encode_name_str(value, platform_id),
                ));
            }
        }
    }

    entries.sort_by_key(|(record, _)| {
        (
            record.platform_id,
            record.encoding_id,
            record.language_id,
            record.name_id,
        )
    });

    let new_records_end = 6 + entries.len() * 12;
    let new_str_offset = new_records_end + prefix.len();
    // Format 1 language-tag offsets refer to the original string storage.
    let language_storage = if format == 1 {
        &name_table[str_offset..]
    } else {
        &[]
    };
    let strings_length =
        language_storage.len() + entries.iter().map(|(_, value)| value.len()).sum::<usize>();
    anyhow::ensure!(
        new_str_offset <= u16::MAX as usize && strings_length <= u16::MAX as usize,
        "Name table is too large"
    );
    let total_length = new_str_offset + strings_length;
    let mut output = vec![0u8; total_length];
    write_u16(&mut output, 0, format)?;
    write_u16(&mut output, 2, entries.len() as u16)?;
    write_u16(&mut output, 4, new_str_offset as u16)?;

    let mut cursor = language_storage.len();
    for (index, (record, value)) in entries.iter().enumerate() {
        let offset = 6 + index * 12;
        write_u16(&mut output, offset, record.platform_id)?;
        write_u16(&mut output, offset + 2, record.encoding_id)?;
        write_u16(&mut output, offset + 4, record.language_id)?;
        write_u16(&mut output, offset + 6, record.name_id)?;
        write_u16(&mut output, offset + 8, value.len() as u16)?;
        write_u16(&mut output, offset + 10, cursor as u16)?;
        cursor += value.len();
    }

    output[new_records_end..new_records_end + prefix.len()].copy_from_slice(&prefix);
    output[new_str_offset..new_str_offset + language_storage.len()]
        .copy_from_slice(language_storage);
    let mut string_cursor = new_str_offset + language_storage.len();
    for (_, encoded) in entries {
        output[string_cursor..string_cursor + encoded.len()].copy_from_slice(&encoded);
        string_cursor += encoded.len();
    }

    Ok(output)
}

fn rebuild_sfnt_with_name_table(
    font_data: &[u8],
    tables: &[TableEntry],
    new_name_table: &[u8],
) -> Result<Vec<u8>> {
    let num_tables = tables.len();
    let header_length = 12 + num_tables * 16;
    let mut payloads = Vec::with_capacity(num_tables);

    for table in tables {
        let mut data = if &table.tag == b"name" {
            new_name_table.to_vec()
        } else {
            slice_range(font_data, table.offset, table.length)?.to_vec()
        };
        // The directory checksum for `head` is always calculated with
        // checkSumAdjustment set to zero. Keeping the old adjustment here made
        // the rebuilt font pass lenient parsers but fail Windows installation.
        if &table.tag == b"head" && data.len() >= 12 {
            write_u32(&mut data, 8, 0)?;
        }
        payloads.push((table.tag, data));
    }

    let mut total_length = align4(header_length);
    for (_, data) in &payloads {
        total_length += align4(data.len());
    }

    let mut output = vec![0u8; total_length];
    output[0..4].copy_from_slice(slice_range(font_data, 0, 4)?);
    write_u16(&mut output, 4, num_tables as u16)?;

    let mut max_pow = 1usize;
    let mut selector = 0u16;
    while max_pow * 2 <= num_tables {
        max_pow *= 2;
        selector += 1;
    }
    write_u16(&mut output, 6, (max_pow * 16) as u16)?;
    write_u16(&mut output, 8, selector)?;
    write_u16(&mut output, 10, (num_tables * 16 - max_pow * 16) as u16)?;

    let mut write_offset = align4(header_length);
    let mut head_table_offset = None;

    for (index, (tag, data)) in payloads.iter().enumerate() {
        let dir_offset = 12 + index * 16;
        output[dir_offset..dir_offset + 4].copy_from_slice(tag);
        write_u32(&mut output, dir_offset + 4, compute_checksum(data))?;
        write_u32(&mut output, dir_offset + 8, write_offset as u32)?;
        write_u32(&mut output, dir_offset + 12, data.len() as u32)?;
        output[write_offset..write_offset + data.len()].copy_from_slice(data);

        if tag == b"head" {
            head_table_offset = Some(write_offset);
        }

        write_offset += align4(data.len());
    }

    if let Some(head_offset) = head_table_offset {
        if head_offset + 12 <= output.len() {
            write_u32(&mut output, head_offset + 8, 0)?;
            let checksum = compute_checksum(&output);
            write_u32(
                &mut output,
                head_offset + 8,
                CHECKSUM_MAGIC.wrapping_sub(checksum),
            )?;
        }
    }

    Ok(output)
}

fn build_name_replacements(family: String, weight: &str, style: &str) -> BTreeMap<u16, String> {
    let is_italic = matches!(style.to_ascii_lowercase().as_str(), "italic" | "oblique");
    let is_bold = weight == "700";
    let win_subfamily = if is_bold && is_italic {
        "Bold Italic"
    } else if is_bold {
        "Bold"
    } else if is_italic {
        "Italic"
    } else {
        "Regular"
    };

    let is_standard_weight = matches!(weight, "400" | "700");
    let win_family = if is_standard_weight {
        family.clone()
    } else {
        format!("{family} {weight}")
    };
    let full_name = if is_standard_weight {
        if win_subfamily == "Regular" {
            family.clone()
        } else {
            format!("{family} {win_subfamily}")
        }
    } else {
        format!("{family} {weight} {win_subfamily}")
    };
    let ps_name = full_name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
        .collect::<String>();

    BTreeMap::from([
        (1, win_family),
        (2, win_subfamily.to_string()),
        (4, full_name),
        (
            6,
            if ps_name.is_empty() {
                "Font".to_string()
            } else {
                ps_name
            },
        ),
    ])
}

fn clean_family_name(value: &str) -> String {
    let cleaned = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || ch.is_ascii_whitespace() || *ch == '-')
        .collect::<String>();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        "Font".to_string()
    } else {
        collapsed
    }
}

fn is_valid_font_name(name: &str) -> bool {
    name.chars().any(|ch| ch.is_alphanumeric())
}

fn decode_name_str(bytes: &[u8], platform_id: u16) -> String {
    if matches!(platform_id, 0 | 3) {
        let words = bytes
            .chunks(2)
            .filter(|chunk| chunk.len() == 2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        String::from_utf16_lossy(&words)
    } else {
        bytes
            .iter()
            .map(|&byte| {
                if byte < 128 {
                    byte as char
                } else {
                    MAC_ROMAN.chars().nth((byte - 128) as usize).unwrap()
                }
            })
            .collect()
    }
}

fn encode_name_str(value: &str, platform_id: u16) -> Vec<u8> {
    if matches!(platform_id, 0 | 3) {
        value
            .encode_utf16()
            .flat_map(|word| word.to_be_bytes())
            .collect()
    } else {
        value
            .chars()
            .map(|ch| {
                if ch.is_ascii() {
                    ch as u8
                } else {
                    MAC_ROMAN
                        .chars()
                        .position(|candidate| candidate == ch)
                        .map(|i| i as u8 + 128)
                        .unwrap_or(b'?')
                }
            })
            .collect()
    }
}

fn compute_checksum(buf: &[u8]) -> u32 {
    let padded_len = align4(buf.len());
    let mut sum = 0u32;
    for offset in (0..padded_len).step_by(4) {
        let bytes = [
            *buf.get(offset).unwrap_or(&0),
            *buf.get(offset + 1).unwrap_or(&0),
            *buf.get(offset + 2).unwrap_or(&0),
            *buf.get(offset + 3).unwrap_or(&0),
        ];
        sum = sum.wrapping_add(u32::from_be_bytes(bytes));
    }
    sum
}

fn align4(value: usize) -> usize {
    (value + 3) & !3
}

fn slice_range(data: &[u8], offset: usize, length: usize) -> Result<&[u8]> {
    data.get(offset..offset + length)
        .ok_or_else(|| anyhow!("Slice out of bounds at {offset}..{}", offset + length))
}

fn read_u16(buf: &[u8], offset: usize) -> Result<u16> {
    let slice = buf
        .get(offset..offset + 2)
        .ok_or_else(|| anyhow!("read_u16 out of bounds at {offset}"))?;
    Ok(u16::from_be_bytes([slice[0], slice[1]]))
}

fn read_u32(buf: &[u8], offset: usize) -> Result<u32> {
    let slice = buf
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("read_u32 out of bounds at {offset}"))?;
    Ok(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn write_u16(buf: &mut [u8], offset: usize, value: u16) -> Result<()> {
    let slice = buf
        .get_mut(offset..offset + 2)
        .ok_or_else(|| anyhow!("write_u16 out of bounds at {offset}"))?;
    slice.copy_from_slice(&value.to_be_bytes());
    Ok(())
}

fn write_u32(buf: &mut [u8], offset: usize, value: u32) -> Result<()> {
    let slice = buf
        .get_mut(offset..offset + 4)
        .ok_or_else(|| anyhow!("write_u32 out of bounds at {offset}"))?;
    slice.copy_from_slice(&value.to_be_bytes());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geist() -> Vec<u8> {
        super::super::decompress_to_sfnt(
            include_bytes!("../web/assets/geist-400.woff2"),
            crate::domain::FontFormat::Woff2,
        )
        .unwrap()
    }

    #[test]
    fn arbitrary_records_are_added_replaced_removed_and_sorted() {
        let original = windows_name_table(&[
            (0, "Copyright"),
            (8, "Old Foundry"),
            (13, "License"),
            (15, "Reserved"),
        ]);
        let patched = patch_name_table(
            &original,
            &BTreeMap::from([
                (0, String::new()),
                (8, "New Foundry".into()),
                (9, "Designer".into()),
                (13, String::new()),
            ]),
        )
        .unwrap();
        let names = read_name_values(&patched).unwrap();
        assert!(!names.contains_key(&0));
        assert!(!names.contains_key(&13));
        assert_eq!(names[&8], "New Foundry");
        assert_eq!(names[&9], "Designer");
        assert_eq!(names[&15], "Reserved");
        let records: Vec<_> = (0..read_u16(&patched, 2).unwrap() as usize)
            .map(|i| {
                let off = 6 + i * 12;
                (
                    read_u16(&patched, off).unwrap(),
                    read_u16(&patched, off + 2).unwrap(),
                    read_u16(&patched, off + 4).unwrap(),
                    read_u16(&patched, off + 6).unwrap(),
                )
            })
            .collect();
        assert!(records.windows(2).all(|w| w[0] <= w[1]));
        assert!(records.contains(&(1, 0, 0, 9)));
        assert!(records.contains(&(3, 1, 0x409, 9)));
        assert!(records.iter().all(|r| ![0, 13].contains(&r.3)));
        let removed = patch_name_table(&patched, &BTreeMap::from([(8, String::new())])).unwrap();
        for i in 0..read_u16(&removed, 2).unwrap() as usize {
            assert_ne!(read_u16(&removed, 6 + i * 12 + 6).unwrap(), 8);
        }
    }

    #[test]
    fn format_one_language_tags_survive_name_replacement() {
        let original = windows_name_table(&[(1, "Original")]);
        let storage = read_u16(&original, 4).unwrap() as usize;
        let mut table = original[..storage].to_vec();
        table.extend_from_slice(&[0, 1, 0, 4, 0, 16]);
        table.extend_from_slice(&original[storage..]);
        table.extend_from_slice(&encode_name_str("en", 3));
        write_u16(&mut table, 0, 1).unwrap();
        write_u16(&mut table, 4, (storage + 6) as u16).unwrap();
        let result = patch_name_table(&table, &BTreeMap::from([(1, "New family".into())])).unwrap();
        let prefix = 6 + read_u16(&result, 2).unwrap() as usize * 12;
        let strings = read_u16(&result, 4).unwrap() as usize;
        let tag_offset = read_u16(&result, prefix + 4).unwrap() as usize;
        assert_eq!(
            decode_name_str(&result[strings + tag_offset..strings + tag_offset + 4], 3),
            "en"
        );
        assert_eq!(read_name_values(&result).unwrap()[&1], "New family");
    }

    #[test]
    fn version_normalizes_and_updates_revision_and_unique_id() {
        assert_eq!(normalize_version("1").unwrap(), "Version 1.000");
        assert_eq!(normalize_version("Version 2.5").unwrap(), "Version 2.500");
        assert_eq!(normalize_version("01.025").unwrap(), "Version 1.025");
        for value in ["-1", "NaN", "1.1234", "32768.0", "1.x"] {
            assert!(normalize_version(value).is_err());
        }
        let font = geist();
        let original = inspect_sfnt_names(&font).unwrap();
        let draft = NameDraft {
            name_changes: Some(BTreeMap::from([
                (5, "2.125".into()),
                (8, "Fount Studio".into()),
                (13, String::new()),
            ])),
            ..NameDraft::default()
        };
        let rewritten = apply_name_draft(&font, &draft).unwrap();
        let names = inspect_sfnt_names(&rewritten).unwrap();
        assert_eq!(names[&5], "Version 2.125");
        assert_eq!(names[&3], format!("2.125;Fount;{}", original[&6]));
        assert_eq!(names[&1], original[&1]);
        assert_eq!(names[&4], original[&4]);
        assert_eq!(names[&8], "Fount Studio");
        assert!(!names.contains_key(&13));
        assert!(names.contains_key(&16) && names.contains_key(&17));
        let tables = parse_tables(&rewritten).unwrap();
        let head = tables.iter().find(|t| &t.tag == b"head").unwrap();
        assert_eq!(read_u32(&rewritten, head.offset + 4).unwrap(), 139264);
        assert_eq!(compute_checksum(&rewritten), CHECKSUM_MAGIC);
    }

    #[test]
    fn woff2_inspect_and_metadata_round_trip() {
        let raw = include_bytes!("../web/assets/geist-400.woff2");
        let original = super::super::inspect_names(raw).unwrap();
        assert!(original.family.as_deref().unwrap().contains("Geist"));
        let draft = NameDraft {
            family: "Fount Geist".into(),
            subfamily: "Regular".into(),
            manufacturer: Some("Fount Studio".into()),
            ..NameDraft::default()
        };
        let output = apply_name_draft(&geist(), &draft).unwrap();
        let names = super::super::inspect_names(&output).unwrap();
        assert_eq!(names.family.as_deref(), Some("Fount Geist"));
        assert_eq!(names.manufacturer.as_deref(), Some("Fount Studio"));
        assert_eq!(names.copyright, original.copyright);
    }

    fn windows_name_table(values: &[(u16, &str)]) -> Vec<u8> {
        let records_end = 6 + values.len() * 12;
        let encoded = values
            .iter()
            .map(|(_, value)| encode_name_str(value, 3))
            .collect::<Vec<_>>();
        let total_length = records_end + encoded.iter().map(Vec::len).sum::<usize>();
        let mut table = vec![0u8; total_length];
        write_u16(&mut table, 0, 0).unwrap();
        write_u16(&mut table, 2, values.len() as u16).unwrap();
        write_u16(&mut table, 4, records_end as u16).unwrap();
        let mut cursor = 0usize;
        for (index, ((name_id, _), value)) in values.iter().zip(&encoded).enumerate() {
            let offset = 6 + index * 12;
            write_u16(&mut table, offset, 3).unwrap();
            write_u16(&mut table, offset + 2, 1).unwrap();
            write_u16(&mut table, offset + 4, 0x0409).unwrap();
            write_u16(&mut table, offset + 6, *name_id).unwrap();
            write_u16(&mut table, offset + 8, value.len() as u16).unwrap();
            write_u16(&mut table, offset + 10, cursor as u16).unwrap();
            cursor += value.len();
        }
        let mut string_cursor = records_end;
        for value in encoded {
            table[string_cursor..string_cursor + value.len()].copy_from_slice(&value);
            string_cursor += value.len();
        }
        table
    }

    #[test]
    fn name_replacements_handle_standard_and_nonstandard_weights() {
        let regular = build_name_replacements("Acme Sans".to_string(), "400", "normal");
        assert_eq!(regular.get(&1).unwrap(), "Acme Sans");
        assert_eq!(regular.get(&2).unwrap(), "Regular");

        let custom = build_name_replacements("Acme Sans".to_string(), "500", "italic");
        assert_eq!(custom.get(&1).unwrap(), "Acme Sans 500");
        assert_eq!(custom.get(&2).unwrap(), "Italic");
    }

    #[test]
    fn utf16_roundtrip_preserves_strings() {
        let encoded = encode_name_str("Acme Sans", 3);
        let decoded = decode_name_str(&encoded, 3);
        assert_eq!(decoded, "Acme Sans");
        assert_eq!(MAC_ROMAN.chars().count(), 128);
        let mac = "Caf\u{e9} \u{a9}";
        assert_eq!(decode_name_str(&encode_name_str(mac, 1), 1), mac);
    }

    #[test]
    fn repair_values_preserve_embedded_family_and_subfamily() {
        let table = windows_name_table(&[(1, "Graphik Web"), (2, "Bold")]);
        let existing = read_name_values(&table).unwrap();
        let fallback = build_name_replacements("font-style-135".to_string(), "400", "normal");
        let family =
            preferred_existing_name(&existing, &[16, 1]).unwrap_or_else(|| fallback[&1].clone());
        let subfamily =
            preferred_existing_name(&existing, &[17, 2]).unwrap_or_else(|| fallback[&2].clone());

        assert_eq!(family, "Graphik Web");
        assert_eq!(subfamily, "Bold");
        assert_eq!(compose_full_name(&family, &subfamily), "Graphik Web Bold");
        assert_eq!(
            compose_post_script_name(&family, &subfamily),
            "GraphikWeb-Bold"
        );
    }

    #[test]
    fn patch_name_table_adds_installation_names() {
        let table = windows_name_table(&[(1, "Graphik Web"), (2, "Regular")]);
        let replacements = BTreeMap::from([
            (1, "Graphik Web".to_string()),
            (2, "Regular".to_string()),
            (3, "1.000;Fount;GraphikWeb-Regular".to_string()),
            (4, "Graphik Web".to_string()),
            (5, "Version 1.000".to_string()),
            (6, "GraphikWeb-Regular".to_string()),
        ]);
        let patched = patch_name_table(&table, &replacements).unwrap();
        let names = read_name_values(&patched).unwrap();

        assert_eq!(read_u16(&patched, 2).unwrap(), 12);
        assert_eq!(names.get(&1).unwrap(), "Graphik Web");
        assert_eq!(names.get(&2).unwrap(), "Regular");
        assert_eq!(names.get(&3).unwrap(), "1.000;Fount;GraphikWeb-Regular");
        assert_eq!(names.get(&4).unwrap(), "Graphik Web");
        assert_eq!(names.get(&5).unwrap(), "Version 1.000");
        assert_eq!(names.get(&6).unwrap(), "GraphikWeb-Regular");
        assert!(REQUIRED_WINDOWS_NAME_IDS
            .iter()
            .all(|name_id| has_valid_windows_name(&patched, *name_id)));
    }

    #[test]
    fn rebuilt_head_directory_checksum_uses_zero_adjustment() {
        let font = geist();
        let tables = parse_tables(&font).unwrap();
        let name = tables.iter().find(|table| &table.tag == b"name").unwrap();
        let name_data = slice_range(&font, name.offset, name.length).unwrap();
        let rebuilt = rebuild_sfnt_with_name_table(&font, &tables, name_data).unwrap();
        let rebuilt_tables = parse_tables(&rebuilt).unwrap();
        let (index, head) = rebuilt_tables
            .iter()
            .enumerate()
            .find(|(_, table)| &table.tag == b"head")
            .unwrap();
        let recorded = read_u32(&rebuilt, 12 + index * 16 + 4).unwrap();
        let mut head_data = slice_range(&rebuilt, head.offset, head.length)
            .unwrap()
            .to_vec();
        write_u32(&mut head_data, 8, 0).unwrap();

        assert_eq!(recorded, compute_checksum(&head_data));
        assert_eq!(compute_checksum(&rebuilt), CHECKSUM_MAGIC);
    }

    #[test]
    fn apply_name_draft_overwrites_existing_windows_names() {
        let font = geist();
        let draft = NameDraft {
            family: "Renamed Sans".into(),
            subfamily: "Bold".into(),
            full_name: None,
            postscript: None,
            filename: None,
            ..NameDraft::default()
        };
        let rewritten = apply_name_draft(&font, &draft).unwrap();
        let tables = parse_tables(&rewritten).unwrap();
        let name = tables.iter().find(|table| &table.tag == b"name").unwrap();
        let name_data = slice_range(&rewritten, name.offset, name.length).unwrap();
        let names = read_name_values(name_data).unwrap();

        assert_eq!(names.get(&1).unwrap(), "Renamed Sans");
        assert_eq!(names.get(&2).unwrap(), "Bold");
        assert_eq!(names.get(&4).unwrap(), "Renamed Sans Bold");
        assert_eq!(names.get(&6).unwrap(), "RenamedSans-Bold");
        assert_eq!(names.get(&16).unwrap(), "Renamed Sans");
        assert_eq!(names.get(&17).unwrap(), "Bold");
        assert!(names.get(&3).unwrap().contains("Fount"));
        assert!(has_valid_windows_name(name_data, 1));
        assert!(has_valid_windows_name(name_data, 16));
        assert_eq!(compute_checksum(&rewritten), CHECKSUM_MAGIC);
    }

    #[test]
    fn apply_name_draft_keeps_cyrillic_family() {
        let font = geist();
        let draft = NameDraft {
            family: "Гарнитура".into(),
            subfamily: "Regular".into(),
            full_name: None,
            postscript: None,
            filename: None,
            ..NameDraft::default()
        };
        let rewritten = apply_name_draft(&font, &draft).unwrap();
        let tables = parse_tables(&rewritten).unwrap();
        let name = tables.iter().find(|table| &table.tag == b"name").unwrap();
        let name_data = slice_range(&rewritten, name.offset, name.length).unwrap();
        let names = read_name_values(name_data).unwrap();
        assert_eq!(names.get(&1).unwrap(), "Гарнитура");
        assert_eq!(names.get(&16).unwrap(), "Гарнитура");
    }
}
