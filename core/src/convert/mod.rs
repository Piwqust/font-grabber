mod name_repair;

use std::fs;

use anyhow::{anyhow, bail, Context, Result};
use ttf_parser::Face;
use wuff::{decompress_woff1, decompress_woff2};

use crate::{
    domain::{CachedFont, ConvertedFont, FontFormat, FontScript, OutputFormat, VariableAxis},
    support::{emit_log, Logger},
};

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
}

pub fn convert_fonts(
    cached_fonts: &[CachedFont],
    logger: Option<Logger>,
) -> Result<ConversionBatch> {
    let mut converted = Vec::new();
    let mut failures = Vec::new();

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

        match convert_font(cached) {
            Ok(font) => converted.push(font),
            Err(error) => failures.push(format!(
                "{} ({} {}): {error}",
                cached.info.family, cached.info.weight, cached.info.style
            )),
        }
    }

    Ok(ConversionBatch {
        converted,
        failures,
    })
}

fn convert_font(cached: &CachedFont) -> Result<ConvertedFont> {
    let raw = fs::read(&cached.cached_path).with_context(|| {
        format!(
            "Failed to read cached font {}",
            cached.cached_path.display()
        )
    })?;
    let sfnt = decompress_to_sfnt(&raw, cached.downloaded_format)?;
    let repaired = name_repair::repair_name_table_if_needed(&sfnt, &cached.info)?;
    analyze_font(repaired, cached)
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
    })
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
    use std::path::Path;

    use crate::domain::FontScript;

    fn fixture(path: &str) -> Vec<u8> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
        fs::read(path).unwrap()
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
        let mono = fixture(
            "fonts/gt-america.com/GT_America_Intl_Mono/GT-America-Intl-Mono-400-Variable.ttf",
        );
        let mono_scripts = detect_supported_scripts(&mono).unwrap();
        assert!(mono_scripts.contains(&FontScript::Latin));
        assert!(mono_scripts.contains(&FontScript::Cyrillic));
        assert!(mono_scripts.contains(&FontScript::Greek));
        assert!(mono_scripts.contains(&FontScript::Vietnamese));
        assert!(!mono_scripts.contains(&FontScript::Arabic));

        let subset = fixture(
            "fonts/gt-america.com/GT_America_Intl_Latin_Subset/GT-America-Intl-Latin-Subset-400-stretch-1%-500%-Variable.ttf",
        );
        let subset_scripts = detect_supported_scripts(&subset).unwrap();
        assert!(subset_scripts.contains(&FontScript::Latin));
        assert!(!subset_scripts.contains(&FontScript::Cyrillic));
        assert!(!subset_scripts.contains(&FontScript::Greek));
        assert!(!subset_scripts.contains(&FontScript::Vietnamese));
    }
}
