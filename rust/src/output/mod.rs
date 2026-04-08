use std::{fs, path::Path};

use anyhow::{Context, Result};

use crate::{
    domain::{ConvertedFont, SavedFont},
    support::{emit_log, next_available_path, sanitize_file_stem, Logger},
};

pub fn save_converted_fonts(
    converted_fonts: &[ConvertedFont],
    output_dir: &Path,
    logger: Option<Logger>,
) -> Result<Vec<SavedFont>> {
    fs::create_dir_all(output_dir)
        .with_context(|| format!("Failed to create output directory {}", output_dir.display()))?;

    let mut saved = Vec::new();

    for font in converted_fonts {
        let filename = build_output_filename(font);
        let path = next_available_path(&output_dir.join(filename));
        fs::write(&path, &font.data)
            .with_context(|| format!("Failed to write converted font {}", path.display()))?;

        emit_log(logger.as_ref(), format!("Saved {}", path.display()));

        saved.push(SavedFont {
            family: font.info.family.clone(),
            style: font.info.style.clone(),
            weight: font.info.weight.clone(),
            stretch: font.info.stretch.clone(),
            unicode_range: font.info.unicode_range.clone(),
            output_path: path,
            output_format: font.output_format,
            variable_axes_preserved: font.variable_axes_preserved,
            axes: font.axes.clone(),
            scan_source: font.info.scan_source,
            transfer_method: font.transfer_method,
            source_url: font.source_url.clone(),
        });
    }

    Ok(saved)
}

fn build_output_filename(font: &ConvertedFont) -> String {
    let family = sanitize_file_stem(&font.info.family);
    let weight = sanitize_file_stem(&font.info.weight).to_ascii_lowercase();
    let style = sanitize_file_stem(&font.info.style).to_ascii_lowercase();
    let stretch_suffix = font
        .info
        .stretch
        .as_ref()
        .map(|stretch| format!("-stretch-{}", sanitize_file_stem(stretch).to_ascii_lowercase()))
        .unwrap_or_default();
    let style_suffix = if matches!(style.as_str(), "normal" | "regular") {
        String::new()
    } else {
        format!("-{style}")
    };
    let variable_suffix = if font.variable_axes_preserved { "-Variable" } else { "" };
    let subset_suffix = font
        .info
        .unicode_range
        .as_ref()
        .map(|range| format!("-subset-{:08x}", fnv1a32(range.as_bytes())))
        .unwrap_or_default();

    format!(
        "{}-{}{}{}{}{}.{}",
        family,
        weight,
        style_suffix,
        stretch_suffix,
        variable_suffix,
        subset_suffix,
        font.output_format.extension()
    )
}

fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut hash = 0x811C9DC5u32;
    for byte in bytes {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ConvertedFont, FontCandidate, FontSource, FontFormat, OutputFormat, ScanSource, TransferMethod};

    fn converted_font() -> ConvertedFont {
        ConvertedFont {
            info: FontCandidate {
                id: "id".into(),
                family: "Acme Sans".into(),
                style: "italic".into(),
                weight: "700".into(),
                stretch: None,
                sources: vec![FontSource { url: "https://example.com/font.woff2".into(), format: FontFormat::Woff2 }],
                unicode_range: None,
                variable: false,
                scan_source: ScanSource::StaticCss,
            },
            data: vec![],
            output_format: OutputFormat::Ttf,
            variable_axes_preserved: false,
            axes: vec![],
            source_url: "https://example.com/font.woff2".into(),
            transfer_method: TransferMethod::Http,
        }
    }

    #[test]
    fn filename_reflects_style_and_variable_state() {
        let mut font = converted_font();
        assert_eq!(build_output_filename(&font), "Acme-Sans-700-italic.ttf");
        font.variable_axes_preserved = true;
        font.output_format = OutputFormat::Otf;
        assert_eq!(build_output_filename(&font), "Acme-Sans-700-italic-Variable.otf");
    }

    #[test]
    fn filename_adds_subset_suffix_when_needed() {
        let mut font = converted_font();
        font.info.unicode_range = Some("U+000-5FF".into());
        assert!(build_output_filename(&font).contains("-subset-"));
    }
}
