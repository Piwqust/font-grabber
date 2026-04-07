use std::fs;

use anyhow::{anyhow, bail, Context, Result};
use ttf_parser::Face;
use wuff::{decompress_woff1, decompress_woff2};

use crate::{
    models::{
        CachedFont, ConvertedFont, DiscoveredFont, FontFormat, Logger, OutputFormat, VariableAxis,
    },
    util::{emit_log, sanitize_file_stem},
};

const WOFF_SIGNATURE: u32 = 0x774F_4646;
const WOFF2_SIGNATURE: u32 = 0x774F_4632;
const SFNT_TRUETYPE: u32 = 0x0001_0000;
const SFNT_OPENTYPE: u32 = 0x4F54_544F;
const SFNT_TRUE: u32 = 0x7472_7565;

pub struct ConversionBatch {
    pub converted: Vec<ConvertedFont>,
    pub failures: Vec<String>,
}

pub fn convert_cached_fonts(
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

        match convert_cached_font(cached) {
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

fn convert_cached_font(cached: &CachedFont) -> Result<ConvertedFont> {
    let raw = fs::read(&cached.cached_path).with_context(|| {
        format!(
            "Failed to read cached font {}",
            cached.cached_path.display()
        )
    })?;
    let sfnt = decompress_to_sfnt(&raw, cached.downloaded_format)?;
    let repaired = repair_name_table_if_needed(&sfnt, &cached.info)?;
    analyze_font(repaired, &cached.info)
}

fn analyze_font(sfnt_data: Vec<u8>, info: &DiscoveredFont) -> Result<ConvertedFont> {
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

    let variable_axes_preserved = face.is_variable() || info.is_variable;
    let filename = build_output_filename(info, variable_axes_preserved, output_format);

    Ok(ConvertedFont {
        info: info.clone(),
        data: sfnt_data,
        output_format,
        filename,
        variable_axes_preserved,
        axes,
    })
}

fn build_output_filename(
    info: &DiscoveredFont,
    is_variable: bool,
    output_format: OutputFormat,
) -> String {
    let family = sanitize_file_stem(&info.family);
    let style_suffix = if matches!(info.style.as_str(), "normal" | "regular") {
        String::new()
    } else {
        format!("-{}", info.style)
    };
    let variable_suffix = if is_variable { "-Variable" } else { "" };
    format!(
        "{}-{}{}{}.{}",
        family,
        info.weight,
        style_suffix,
        variable_suffix,
        output_format.extension()
    )
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

fn decompress_to_sfnt(data: &[u8], format: FontFormat) -> Result<Vec<u8>> {
    match format {
        FontFormat::Woff2 => Ok(decompress_woff2(data).context("WOFF2 decompression failed")?),
        FontFormat::Woff => Ok(decompress_woff1(data).context("WOFF decompression failed")?),
        FontFormat::TrueType | FontFormat::OpenType => Ok(data.to_vec()),
        FontFormat::EmbeddedOpenType | FontFormat::Svg => {
            bail!("Unsupported font format: {format}")
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

fn repair_name_table_if_needed(sfnt_data: &[u8], info: &DiscoveredFont) -> Result<Vec<u8>> {
    let _ = info;
    // Intentionally conservative for v1: keep the original sfnt untouched.
    // The legacy TypeScript implementation attempted broad name-table rewrites,
    // but that is risky without full encoding/language preservation.
    Ok(sfnt_data.to_vec())
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

    fn discovered_font() -> DiscoveredFont {
        DiscoveredFont {
            id: "id".into(),
            family: "Acme Sans".into(),
            style: "italic".into(),
            weight: "700".into(),
            sources: vec![],
            is_variable: false,
            unicode_range: None,
            scan_source: crate::models::ScanSource::StaticCss,
        }
    }

    #[test]
    fn axis_name_maps_common_tags() {
        assert_eq!(axis_name(b"wght"), "Weight");
        assert_eq!(axis_name(b"XXXX"), "XXXX");
    }

    #[test]
    fn build_output_filename_reflects_style_and_variable_state() {
        let mut info = discovered_font();
        assert_eq!(
            build_output_filename(&info, false, OutputFormat::Ttf),
            "Acme-Sans-700-italic.ttf"
        );
        assert_eq!(
            build_output_filename(&info, true, OutputFormat::Otf),
            "Acme-Sans-700-italic-Variable.otf"
        );
        info.style = "normal".into();
        assert_eq!(
            build_output_filename(&info, false, OutputFormat::Ttf),
            "Acme-Sans-700.ttf"
        );
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
}
