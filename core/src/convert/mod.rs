mod merge;
mod name_repair;

use std::{collections::HashMap, fs};

use anyhow::{anyhow, bail, Context, Result};
use ttf_parser::{name_id, Face, PlatformId};
use wuff::{decompress_woff1, decompress_woff2};

use crate::{
    domain::{
        CachedFont, ConvertedFont, FontCandidate, FontFormat, FontScript, NameDraft, OutputFormat,
        VariableAxis,
    },
    support::{emit_log, sanitize_file_stem, Logger},
};

pub use name_repair::normalize_version;
pub use name_repair::subfamily_from_weight_style;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NameSet {
    pub family: Option<String>,
    pub subfamily: Option<String>,
    pub full_name: Option<String>,
    pub postscript: Option<String>,
    pub version: Option<String>,
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub manufacturer: Option<String>,
    pub designer: Option<String>,
    pub description: Option<String>,
    pub vendor_url: Option<String>,
    pub designer_url: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
}

impl NameSet {
    pub fn changes(&self) -> std::collections::BTreeMap<u16, String> {
        [
            (0, &self.copyright),
            (1, &self.family),
            (2, &self.subfamily),
            (4, &self.full_name),
            (5, &self.version),
            (6, &self.postscript),
            (7, &self.trademark),
            (8, &self.manufacturer),
            (9, &self.designer),
            (10, &self.description),
            (11, &self.vendor_url),
            (12, &self.designer_url),
            (13, &self.license),
            (14, &self.license_url),
        ]
        .into_iter()
        .filter_map(|(id, value)| value.clone().map(|v| (id, v)))
        .collect()
    }
}

pub fn inspect_names(bytes: &[u8]) -> Result<NameSet> {
    let sfnt = decompress_to_sfnt(bytes, FontFormat::sniff(bytes))?;
    Face::parse(&sfnt, 0).context("Could not parse font")?;
    let names = name_repair::inspect_sfnt_names(&sfnt)?;
    // Fonts that had their names scrubbed for the web keep a placeholder such
    // as "." — that is no name, and callers fall back to what the scan knows.
    let get = |id| {
        names
            .get(&id)
            .filter(|value| value.chars().any(char::is_alphanumeric))
            .cloned()
    };
    Ok(NameSet {
        family: get(16).or_else(|| get(1)),
        subfamily: get(17).or_else(|| get(2)),
        full_name: get(4),
        postscript: get(6),
        version: get(5),
        copyright: get(0),
        trademark: get(7),
        manufacturer: get(8),
        designer: get(9),
        description: get(10),
        vendor_url: get(11),
        designer_url: get(12),
        license: get(13),
        license_url: get(14),
    })
}

const WOFF_SIGNATURE: u32 = 0x774F_4646;
const WOFF2_SIGNATURE: u32 = 0x774F_4632;
const SFNT_TRUETYPE: u32 = 0x0001_0000;
const SFNT_OPENTYPE: u32 = 0x4F54_544F;
const SFNT_TRUE: u32 = 0x7472_7565;
const MAX_BATCH_OUTPUT_BYTES: usize = 128 * 1024 * 1024;
const LATIN_PROBES: &[char] = &['A', 'a'];
const CYRILLIC_PROBES: &[char] = &['Ж', 'ж', 'Я', 'я'];
const GREEK_PROBES: &[char] = &['Ω', 'β'];
const VIETNAMESE_PROBES: &[char] = &['Ắ', 'ơ', 'Đ'];
const ARABIC_PROBES: &[char] = &['ع', 'ي', 'ك'];
const HEBREW_PROBES: &[char] = &['א', 'ש'];
const DEVANAGARI_PROBES: &[char] = &['अ', 'क'];
const KOREAN_PROBES: &[char] = &['가', '한'];
const THAI_PROBES: &[char] = &['ก', 'ำ'];
const SCRIPT_PROBES: &[(FontScript, &[char])] = &[
    (FontScript::Latin, LATIN_PROBES),
    (FontScript::Cyrillic, CYRILLIC_PROBES),
    (FontScript::Greek, GREEK_PROBES),
    (FontScript::Vietnamese, VIETNAMESE_PROBES),
    (FontScript::Arabic, ARABIC_PROBES),
    (FontScript::Hebrew, HEBREW_PROBES),
    (FontScript::Devanagari, DEVANAGARI_PROBES),
    (FontScript::Korean, KOREAN_PROBES),
    (FontScript::Thai, THAI_PROBES),
];

pub struct ConversionBatch {
    pub converted: Vec<ConvertedFont>,
    pub failures: Vec<String>,
    pub failure_details: Vec<(String, String)>,
}

pub fn convert_fonts(
    cached_fonts: &[CachedFont],
    drafts: Option<&HashMap<String, NameDraft>>,
    logger: Option<Logger>,
) -> Result<ConversionBatch> {
    convert_fonts_within(cached_fonts, drafts, logger, MAX_BATCH_OUTPUT_BYTES)
}

fn convert_fonts_within(
    cached_fonts: &[CachedFont],
    drafts: Option<&HashMap<String, NameDraft>>,
    logger: Option<Logger>,
    max_total_bytes: usize,
) -> Result<ConversionBatch> {
    let mut converted = Vec::new();
    let mut failures = Vec::new();
    let mut failure_details = Vec::new();
    let mut total_bytes = 0usize;

    for (index, cached) in cached_fonts.iter().enumerate() {
        emit_log(
            logger.as_ref(),
            format!(
                "Converting {}/{}: {}",
                index + 1,
                cached_fonts.len(),
                cached.info.family
            ),
        );

        let draft = drafts.and_then(|map| map.get(&cached.info.id));
        let result = convert_font(cached, draft).and_then(|fonts| {
            // Over-budget fonts fail individually so the ones already converted still ship.
            let size: usize = fonts.iter().map(|font| font.data.len()).sum();
            anyhow::ensure!(
                total_bytes + size <= max_total_bytes,
                "Expanded fonts exceed 128 MiB. Choose fewer files."
            );
            Ok(fonts)
        });
        match result {
            Ok(fonts) => {
                total_bytes += fonts.iter().map(|font| font.data.len()).sum::<usize>();
                converted.extend(fonts);
            }
            Err(error) => {
                failure_details.push((cached.info.id.clone(), error.to_string()));
                failures.push(format!(
                    "{} ({} {}): {error}",
                    cached.info.family, cached.info.weight, cached.info.style
                ));
            }
        }
    }

    Ok(ConversionBatch {
        converted,
        failures,
        failure_details,
    })
}

/// The face as one font: its own file with any pieces the site split off
/// joined back on. When the pieces cannot be joined they come back as well,
/// so the caller can still deliver every character.
pub fn load_joined_sfnt(cached: &CachedFont) -> Result<(Vec<u8>, Vec<Vec<u8>>)> {
    let raw = fs::read(&cached.cached_path).with_context(|| {
        format!(
            "Failed to read cached font {}",
            cached.cached_path.display()
        )
    })?;
    let base = decompress_to_sfnt(&raw, cached.downloaded_format)?;
    if cached.parts.is_empty() {
        return Ok((base, Vec::new()));
    }
    let pieces = cached
        .parts
        .iter()
        .map(|part| {
            let raw = fs::read(&part.path)
                .with_context(|| format!("Failed to read {}", part.path.display()))?;
            decompress_to_sfnt(&raw, part.format)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(match merge::merge_sfnts(&base, &pieces) {
        Ok(joined) => (joined, Vec::new()),
        Err(_) => (base, pieces),
    })
}

fn convert_font(cached: &CachedFont, draft: Option<&NameDraft>) -> Result<Vec<ConvertedFont>> {
    let (sfnt, leftovers) = load_joined_sfnt(cached)?;
    let mut fonts = vec![convert_sfnt(sfnt, cached, draft)?];
    // Pieces that could not be joined ship as families of their own, named so
    // they install beside the main face instead of replacing it.
    for (index, piece) in leftovers.into_iter().enumerate() {
        let mut info = cached.info.clone();
        let family = draft
            .map(|draft| draft.family.trim())
            .filter(|family| !family.is_empty())
            .unwrap_or(&info.family)
            .to_string();
        info.id = format!("{}#part{}", info.id, index + 2);
        info.family = format!("{family} Part {}", index + 2);
        let named = name_repair::apply_name_draft(
            &piece,
            &NameDraft {
                family: info.family.clone(),
                subfamily: subfamily_from_weight_style(&info.weight, &info.style),
                ..NameDraft::default()
            },
        )?;
        let piece_cached = CachedFont {
            info,
            parts: Vec::new(),
            ..cached.clone()
        };
        fonts.push(analyze_font(named, &piece_cached)?);
    }
    Ok(fonts)
}

fn convert_sfnt(
    sfnt: Vec<u8>,
    cached: &CachedFont,
    draft: Option<&NameDraft>,
) -> Result<ConvertedFont> {
    let resolved = draft.map(|draft| resolve_draft_names(&sfnt, draft, &cached.info));
    let draft = resolved.as_ref();
    let named = if let Some(draft) = draft {
        name_repair::apply_name_draft(&sfnt, draft)?
    } else {
        name_repair::repair_name_table_if_needed(&sfnt, &cached.info)?
    };
    let mut converted = analyze_font(named, cached)?;
    if let Some(draft) = draft {
        if !draft.family.trim().is_empty() {
            converted.info.family = draft.family.trim().to_string();
        }
        converted.output_stem = draft_output_stem(draft);
    }
    Ok(converted)
}

/// A blank family or subfamily in a legacy draft (e.g. CLI `--family` alone)
/// keeps the font's own embedded name; deriving it from the CSS weight gave
/// every non-bold weight the same "Regular" subfamily and colliding names.
fn resolve_draft_names(sfnt: &[u8], draft: &NameDraft, info: &FontCandidate) -> NameDraft {
    let mut draft = draft.clone();
    if draft.name_changes.is_some()
        || (!draft.family.trim().is_empty() && !draft.subfamily.trim().is_empty())
    {
        return draft;
    }
    let embedded = name_repair::inspect_sfnt_names(sfnt).unwrap_or_default();
    if draft.family.trim().is_empty() {
        draft.family = name_repair::preferred_existing_name(&embedded, &[16, 1])
            .unwrap_or_else(|| info.family.clone());
    }
    if draft.subfamily.trim().is_empty() {
        draft.subfamily = name_repair::preferred_existing_name(&embedded, &[17, 2])
            .unwrap_or_else(|| subfamily_from_weight_style(&info.weight, &info.style));
    }
    draft
}

fn draft_output_stem(draft: &NameDraft) -> Option<String> {
    let explicit = draft
        .filename
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .trim_end_matches(".ttf")
                .trim_end_matches(".otf")
                .trim_end_matches(".TTF")
                .trim_end_matches(".OTF")
                .to_string()
        })
        .filter(|value| !value.is_empty());
    if explicit.is_some() {
        return explicit;
    }

    let family = sanitize_file_stem(&draft.family);
    let subfamily = sanitize_file_stem(&draft.subfamily);
    if subfamily.is_empty() || subfamily.eq_ignore_ascii_case("regular") {
        Some(family)
    } else {
        Some(format!("{family}-{subfamily}"))
    }
}

fn analyze_font(sfnt_data: Vec<u8>, cached: &CachedFont) -> Result<ConvertedFont> {
    let face = Face::parse(&sfnt_data, 0).context("Could not parse converted font data")?;
    let output_format = detect_sfnt_type(&sfnt_data)?;
    let axes = face
        .variation_axes()
        .into_iter()
        .map(|axis| {
            let tag = axis.tag.to_bytes();
            VariableAxis {
                tag: String::from_utf8_lossy(&tag).to_string(),
                name: axis_name(&tag),
                min: axis.min_value,
                default: axis.def_value,
                max: axis.max_value,
            }
        })
        .collect::<Vec<_>>();

    let variable_axes_preserved = face.is_variable() || cached.info.variable;
    let mut info = cached.info.clone();
    refresh_info_from_face(&mut info, &face);
    info.scripts
        .extend(detect_supported_scripts_from_face(&face));
    info.scripts.sort();
    info.scripts.dedup();

    Ok(ConvertedFont {
        info,
        data: sfnt_data,
        output_format,
        variable_axes_preserved,
        axes,
        source_url: cached.source_url.clone(),
        transfer_method: cached.transfer_method,
        output_stem: None,
    })
}

fn refresh_info_from_face(info: &mut FontCandidate, face: &Face<'_>) {
    if let Some(family) = preferred_face_name(face, &[name_id::TYPOGRAPHIC_FAMILY, name_id::FAMILY])
    {
        info.family = family;
    }
    info.weight = face.weight().to_number().to_string();
    info.style = if face.is_oblique() {
        "oblique".to_string()
    } else if face.is_italic() {
        "italic".to_string()
    } else {
        "normal".to_string()
    };
}

fn preferred_face_name(face: &Face<'_>, name_ids: &[u16]) -> Option<String> {
    for name_id in name_ids {
        if let Some((_, value)) = face
            .names()
            .into_iter()
            .filter(|name| name.name_id == *name_id)
            .filter_map(|name| {
                let platform_id = match name.platform_id {
                    PlatformId::Unicode => 0,
                    PlatformId::Macintosh => 1,
                    PlatformId::Iso => 2,
                    PlatformId::Windows => 3,
                    PlatformId::Custom => 4,
                };
                let rank =
                    name_repair::name_record_rank(platform_id, name.encoding_id, name.language_id);
                name.to_string().map(|value| (rank, value))
            })
            .filter(|(_, value)| value.chars().any(|character| character.is_alphanumeric()))
            .min_by_key(|(rank, _)| *rank)
        {
            return Some(value);
        }
    }
    None
}

fn axis_name(tag: &[u8; 4]) -> String {
    match tag {
        b"wght" => "Weight".to_string(),
        b"wdth" => "Width".to_string(),
        b"ital" => "Italic".to_string(),
        b"slnt" => "Slant".to_string(),
        b"opsz" => "Optical Size".to_string(),
        b"GRAD" => "Grade".to_string(),
        _ => String::from_utf8_lossy(tag).to_string(),
    }
}

pub(crate) fn detect_supported_scripts(sfnt_data: &[u8]) -> Result<Vec<FontScript>> {
    let face =
        Face::parse(sfnt_data, 0).context("Could not parse font data for script detection")?;
    Ok(detect_supported_scripts_from_face(&face))
}

fn detect_supported_scripts_from_face(face: &Face<'_>) -> Vec<FontScript> {
    let mut scripts = Vec::new();
    for (script, probes) in SCRIPT_PROBES {
        if probes.iter().all(|ch| face.glyph_index(*ch).is_some()) {
            scripts.push(*script);
        }
    }
    scripts
}

pub(crate) fn decompress_to_sfnt(data: &[u8], format: FontFormat) -> Result<Vec<u8>> {
    anyhow::ensure!(
        data.len() <= 64 * 1024 * 1024,
        "Font exceeds the 64 MiB limit"
    );
    let signature = read_u32(data, 0)?;
    if matches!(signature, WOFF_SIGNATURE | WOFF2_SIGNATURE) {
        anyhow::ensure!(
            read_u32(data, 16)? <= 32 * 1024 * 1024,
            "Expanded font exceeds the 32 MiB limit"
        );
    }
    match format {
        FontFormat::Woff2 => Ok(decompress_woff2(data).context("WOFF2 decompression failed")?),
        FontFormat::Woff => Ok(decompress_woff1(data).context("WOFF decompression failed")?),
        FontFormat::TrueType | FontFormat::OpenType => Ok(data.to_vec()),
        FontFormat::EmbeddedOpenType | FontFormat::Svg => {
            bail!("Unsupported font format: {}", format.label())
        }
        FontFormat::Unknown => match read_u32(data, 0)? {
            WOFF2_SIGNATURE => Ok(decompress_woff2(data).context("WOFF2 decompression failed")?),
            WOFF_SIGNATURE => Ok(decompress_woff1(data).context("WOFF decompression failed")?),
            SFNT_TRUETYPE | SFNT_OPENTYPE | SFNT_TRUE => Ok(data.to_vec()),
            signature => bail!("Unsupported font signature: 0x{signature:08x}"),
        },
    }
}

fn detect_sfnt_type(data: &[u8]) -> Result<OutputFormat> {
    match read_u32(data, 0)? {
        SFNT_OPENTYPE => Ok(OutputFormat::Otf),
        SFNT_TRUETYPE | SFNT_TRUE => Ok(OutputFormat::Ttf),
        signature => bail!("Unknown sfnt signature: 0x{signature:08x}"),
    }
}

fn read_u32(buf: &[u8], offset: usize) -> Result<u32> {
    let slice = buf
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("read_u32 out of bounds at {offset}"))?;
    Ok(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    use crate::domain::FontScript;

    pub(crate) fn script_fixture(probes: &[&[char]]) -> Vec<u8> {
        let mut font = decompress_to_sfnt(
            include_bytes!("../web/assets/geist-400.woff2"),
            FontFormat::Woff2,
        )
        .unwrap();
        let chars: std::collections::BTreeSet<_> =
            probes.iter().flat_map(|p| p.iter().copied()).collect();
        // A format-12 cmap makes coverage deterministic without ignored font downloads.
        let mut cmap = vec![0, 0, 0, 1, 0, 3, 0, 10, 0, 0, 0, 12, 0, 12, 0, 0];
        cmap.extend_from_slice(&(16 + chars.len() as u32 * 12).to_be_bytes());
        cmap.extend_from_slice(&0u32.to_be_bytes());
        cmap.extend_from_slice(&(chars.len() as u32).to_be_bytes());
        for ch in chars {
            cmap.extend_from_slice(&(ch as u32).to_be_bytes());
            cmap.extend_from_slice(&(ch as u32).to_be_bytes());
            cmap.extend_from_slice(&1u32.to_be_bytes());
        }
        let count = u16::from_be_bytes([font[4], font[5]]) as usize;
        let record = (0..count)
            .map(|i| 12 + i * 16)
            .find(|&i| &font[i..i + 4] == b"cmap")
            .unwrap();
        let offset = font.len() as u32;
        font[record + 8..record + 12].copy_from_slice(&offset.to_be_bytes());
        font[record + 12..record + 16].copy_from_slice(&(cmap.len() as u32).to_be_bytes());
        font.extend_from_slice(&cmap);
        font
    }

    fn cached_geist(directory: &std::path::Path, id: &str, weight: &str) -> CachedFont {
        let path = directory.join(format!("{id}.woff2"));
        fs::write(&path, include_bytes!("../web/assets/geist-400.woff2")).unwrap();
        CachedFont {
            info: FontCandidate {
                id: id.into(),
                family: "css-alias".into(),
                style: "normal".into(),
                weight: weight.into(),
                stretch: None,
                sources: vec![],
                unicode_range: None,
                scripts: vec![],
                variable: false,
                scan_source: crate::domain::ScanSource::StaticCss,
                parts: Vec::new(),
                css_family: None,
            },
            cached_path: path,
            downloaded_format: FontFormat::Woff2,
            source_url: "https://example.com/geist.woff2".into(),
            transfer_method: crate::domain::TransferMethod::Http,
            parts: Vec::new(),
        }
    }

    fn cached_pieces(directory: &std::path::Path, base: &[u8], piece: &[u8]) -> CachedFont {
        let mut cached = cached_geist(directory, "split", "400");
        fs::write(&cached.cached_path, base).unwrap();
        let piece_path = directory.join("split-2.woff2");
        fs::write(&piece_path, piece).unwrap();
        cached.parts.push(crate::domain::CachedPart {
            path: piece_path,
            format: FontFormat::Woff2,
        });
        cached
    }

    #[test]
    fn pieces_of_a_split_face_export_as_one_font() {
        let directory = tempfile::tempdir().unwrap();
        let cached = cached_pieces(
            directory.path(),
            include_bytes!("fixtures/tt-core.woff2"),
            include_bytes!("fixtures/tt-ext.woff2"),
        );
        let fonts = convert_font(&cached, None).unwrap();
        assert_eq!(fonts.len(), 1);
        let face = Face::parse(&fonts[0].data, 0).unwrap();
        assert!(face.glyph_index('A').is_some() && face.glyph_index('é').is_some());
    }

    #[test]
    fn pieces_that_cannot_be_joined_still_ship_every_file() {
        let directory = tempfile::tempdir().unwrap();
        let cached = cached_pieces(
            directory.path(),
            include_bytes!("fixtures/cff-core.woff2"),
            include_bytes!("fixtures/cff-ext.woff2"),
        );
        let fonts = convert_font(&cached, None).unwrap();
        assert_eq!(fonts.len(), 2);
        let names = inspect_names(&fonts[1].data).unwrap();
        assert!(names.family.unwrap().ends_with("Part 2"));
    }

    #[test]
    fn batch_size_limit_fails_only_the_fonts_over_budget() {
        let directory = tempfile::tempdir().unwrap();
        let fonts: Vec<_> = ["a", "b", "c"]
            .iter()
            .map(|id| cached_geist(directory.path(), id, "400"))
            .collect();
        let one = convert_fonts_within(&fonts[..1], None, None, usize::MAX).unwrap();
        let size = one.converted[0].data.len();

        let batch = convert_fonts_within(&fonts, None, None, size * 3 / 2).unwrap();
        assert_eq!(batch.converted.len(), 1);
        assert_eq!(batch.converted[0].info.id, "a");
        assert_eq!(batch.failure_details.len(), 2);
        assert!(batch.failures[0].contains("128 MiB"));
    }

    #[test]
    fn blank_draft_names_keep_the_embedded_names() {
        let directory = tempfile::tempdir().unwrap();
        let original = inspect_names(include_bytes!("../web/assets/geist-400.woff2")).unwrap();
        // A CSS weight of 700 used to force "Bold" even though the face is Regular.
        let cached = cached_geist(directory.path(), "a", "700");

        let family_only = NameDraft {
            family: "Renamed".into(),
            ..NameDraft::default()
        };
        let font = convert_font(&cached, Some(&family_only)).unwrap().remove(0);
        let names = inspect_names(&font.data).unwrap();
        assert_eq!(names.family.as_deref(), Some("Renamed"));
        assert_eq!(names.subfamily, original.subfamily);

        let subfamily_only = NameDraft {
            subfamily: "Condensed".into(),
            ..NameDraft::default()
        };
        let font = convert_font(&cached, Some(&subfamily_only)).unwrap().remove(0);
        let names = inspect_names(&font.data).unwrap();
        assert_eq!(names.family, original.family);
        assert_eq!(names.subfamily.as_deref(), Some("Condensed"));
    }

    #[test]
    fn axis_name_maps_common_tags() {
        assert_eq!(axis_name(b"wght"), "Weight");
        assert_eq!(axis_name(b"XXXX"), "XXXX");
    }

    #[test]
    fn oversized_expanded_font_is_rejected_before_decompression() {
        let mut data = include_bytes!("../web/assets/geist-400.woff2").to_vec();
        data[16..20].copy_from_slice(&(33u32 * 1024 * 1024).to_be_bytes());
        assert!(decompress_to_sfnt(&data, FontFormat::Woff2)
            .unwrap_err()
            .to_string()
            .contains("32 MiB"));
    }

    #[test]
    fn detect_sfnt_type_distinguishes_ttf_and_otf() {
        assert_eq!(
            detect_sfnt_type(&0x0001_0000u32.to_be_bytes()).unwrap(),
            OutputFormat::Ttf
        );
        assert_eq!(detect_sfnt_type(b"OTTO").unwrap(), OutputFormat::Otf);
    }

    #[test]
    fn detect_sfnt_type_rejects_unknown_signature() {
        let err = detect_sfnt_type(b"ZZZZ").unwrap_err();
        assert!(err.to_string().contains("Unknown sfnt signature"));
    }

    #[test]
    fn detect_supported_scripts_distinguishes_intl_and_latin_subset_fonts() {
        let mono = script_fixture(&[
            LATIN_PROBES,
            CYRILLIC_PROBES,
            GREEK_PROBES,
            VIETNAMESE_PROBES,
        ]);
        let mono_scripts = detect_supported_scripts(&mono).unwrap();
        assert!(mono_scripts.contains(&FontScript::Latin));
        assert!(mono_scripts.contains(&FontScript::Cyrillic));
        assert!(mono_scripts.contains(&FontScript::Greek));
        assert!(mono_scripts.contains(&FontScript::Vietnamese));
        assert!(!mono_scripts.contains(&FontScript::Arabic));

        let subset = script_fixture(&[LATIN_PROBES]);
        let subset_scripts = detect_supported_scripts(&subset).unwrap();
        assert!(subset_scripts.contains(&FontScript::Latin));
        assert!(!subset_scripts.contains(&FontScript::Cyrillic));
        assert!(!subset_scripts.contains(&FontScript::Greek));
        assert!(!subset_scripts.contains(&FontScript::Vietnamese));
    }
}
