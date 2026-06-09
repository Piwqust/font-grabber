//! Font name-table repair, ported verbatim from `core/src/convert/name_repair.rs`
//! except that it takes plain `family`/`weight`/`style` strings instead of a
//! `FontCandidate`, so it carries no dependency on the CLI's domain types.

use std::collections::BTreeMap;

use anyhow::{anyhow, Result};

const CHECKSUM_MAGIC: u32 = 0xB1B0_AFBA;

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

pub fn repair_name_table_if_needed(
    sfnt_data: &[u8],
    family: &str,
    weight: &str,
    style: &str,
) -> Result<Vec<u8>> {
    let tables = parse_tables(sfnt_data)?;
    let Some(name_entry) = tables.iter().find(|entry| &entry.tag == b"name") else {
        return Ok(sfnt_data.to_vec());
    };
    let name_table = slice_range(sfnt_data, name_entry.offset, name_entry.length)?;
    if name_table.len() < 6 {
        return Ok(sfnt_data.to_vec());
    }

    let count = read_u16(name_table, 2)? as usize;
    let str_offset = read_u16(name_table, 4)? as usize;
    let mut family_name = String::new();
    let mut ps_name = String::new();

    for index in 0..count {
        let offset = 6 + index * 12;
        if offset + 12 > name_table.len() {
            break;
        }

        let platform_id = read_u16(name_table, offset)?;
        let name_id = read_u16(name_table, offset + 6)?;
        if name_id != 1 && name_id != 6 {
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
        if name_id == 1 && family_name.is_empty() {
            family_name = value.clone();
        }
        if name_id == 6 && ps_name.is_empty() {
            ps_name = value;
        }
    }

    if is_valid_font_name(&family_name) && is_valid_font_name(&ps_name) {
        return Ok(sfnt_data.to_vec());
    }

    let replacements = build_name_replacements(clean_family_name(family), weight, style);
    let new_name_table = patch_name_table(name_table, &replacements)?;
    rebuild_sfnt_with_name_table(sfnt_data, &tables, &new_name_table)
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
    let mut records = Vec::with_capacity(count);
    let mut encoded_strings = Vec::with_capacity(count);

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
        let value = replacements
            .get(&record.name_id)
            .cloned()
            .unwrap_or_else(|| decode_name_str(raw, record.platform_id));

        records.push(record);
        encoded_strings.push(encode_name_str(&value, record.platform_id));
    }

    let new_str_offset = records_end + prefix.len();
    let total_length = new_str_offset + encoded_strings.iter().map(Vec::len).sum::<usize>();
    let mut output = vec![0u8; total_length];
    write_u16(&mut output, 0, format)?;
    write_u16(&mut output, 2, records.len() as u16)?;
    write_u16(&mut output, 4, new_str_offset as u16)?;

    let mut cursor = 0usize;
    for (index, record) in records.iter().enumerate() {
        let offset = 6 + index * 12;
        write_u16(&mut output, offset, record.platform_id)?;
        write_u16(&mut output, offset + 2, record.encoding_id)?;
        write_u16(&mut output, offset + 4, record.language_id)?;
        write_u16(&mut output, offset + 6, record.name_id)?;
        write_u16(&mut output, offset + 8, encoded_strings[index].len() as u16)?;
        write_u16(&mut output, offset + 10, cursor as u16)?;
        cursor += encoded_strings[index].len();
    }

    output[records_end..records_end + prefix.len()].copy_from_slice(&prefix);
    let mut string_cursor = new_str_offset;
    for encoded in encoded_strings {
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
        let data = if &table.tag == b"name" {
            new_name_table.to_vec()
        } else {
            slice_range(font_data, table.offset, table.length)?.to_vec()
        };
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
    name.chars().any(|ch| ch.is_ascii_alphanumeric())
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
        bytes.iter().map(|byte| *byte as char).collect()
    }
}

fn encode_name_str(value: &str, platform_id: u16) -> Vec<u8> {
    if matches!(platform_id, 0 | 3) {
        value
            .encode_utf16()
            .flat_map(|word| word.to_be_bytes())
            .collect()
    } else {
        value.bytes().collect()
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
