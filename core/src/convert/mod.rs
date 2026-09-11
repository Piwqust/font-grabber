mod name_repair;

use std::{collections::HashMap, fs};

use anyhow::{anyhow, bail, Context, Result};
use ttf_parser::{name_id, Face};
use wuff::{decompress_woff1, decompress_woff2};

use crate::{
    domain::{
        CachedFont, ConvertedFont, FontFormat, FontScript, NameDraft, OutputFormat, VariableAxis,
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
    let get = |id| names.get(&id).cloned();
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
    let mut converted = Vec::new();
    let mut failures = Vec::new();
    let mut failure_details = Vec::new();

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
        match convert_font(cached, draft) {
            Ok(font) => converted.push(font),
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

fn convert_font(cached: &CachedFont, draft: Option<&NameDraft>) -> Result<ConvertedFont> {
    let raw = fs::read(&cached.cached_path).with_context(|| {
        format!(
            "Failed to read cached font {}",
            cached.cached_path.display()
        )
    })?;
    let sfnt = decompress_to_sfnt(&raw, cached.downloaded_format)?;
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

fn refresh_info_from_face(info: &mut crate::domain::FontCandidate, face: &Face<'_>) {
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
        if let Some(value) = face
            .names()
            .into_iter()
            .filter(|name| name.name_id == *name_id)
            .filter_map(|name| name.to_string())
            .find(|value| value.chars().any(|character| character.is_alphanumeric()))
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
mod tests {
    use super::*;

    use crate::domain::FontScript;

    fn script_fixture(probes: &[&[char]]) -> Vec<u8> {
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

    #[test]
    fn axis_name_maps_common_tags() {
        assert_eq!(axis_name(b"wght"), "Weight");
        assert_eq!(axis_name(b"XXXX"), "XXXX");
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
