use std::{fs, path::Path};

use anyhow::{anyhow, Context, Result};

use crate::{
    domain::{ConvertedFont, SavedFont},
    support::{emit_log, sanitize_file_stem, write_unique_file, Logger},
};

pub struct SaveBatch {
    pub saved: Vec<SavedFont>,
    pub failures: Vec<String>,
    /// (font id, error) for each font that could not be written.
    pub failure_details: Vec<(String, String)>,
}

/// Saves what it can and returns an error only when nothing was saved, so a
/// single-font call keeps its old meaning. Use [`save_converted_fonts_report`]
/// to see per-file failures of a partially saved batch.
pub fn save_converted_fonts(
    converted_fonts: &[ConvertedFont],
    output_dir: &Path,
    logger: Option<Logger>,
) -> Result<Vec<SavedFont>> {
    let batch = save_converted_fonts_report(converted_fonts, output_dir, logger)?;
    if batch.saved.is_empty() {
        if let Some((_, error)) = batch.failure_details.into_iter().next() {
            return Err(anyhow!(error));
        }
    }
    Ok(batch.saved)
}

/// One unwritable file (bad name, permissions) must not discard the rest of the batch.
pub fn save_converted_fonts_report(
    converted_fonts: &[ConvertedFont],
    output_dir: &Path,
    logger: Option<Logger>,
) -> Result<SaveBatch> {
    fs::create_dir_all(output_dir)
        .with_context(|| format!("Failed to create output directory {}", output_dir.display()))?;

    let mut saved = Vec::new();
    let mut failures = Vec::new();
    let mut failure_details = Vec::new();

    for font in converted_fonts {
        let filename = build_output_filename(font);
        let path = match write_unique_file(&output_dir.join(&filename), &font.data)
            .with_context(|| format!("Failed to write converted font {filename}"))
        {
            Ok(path) => path,
            Err(error) => {
                emit_log(logger.as_ref(), format!("{error:#}"));
                failure_details.push((font.info.id.clone(), format!("{error:#}")));
                failures.push(format!(
                    "{} ({} {}): {error:#}",
                    font.info.family, font.info.weight, font.info.style
                ));
                continue;
            }
        };

        emit_log(logger.as_ref(), format!("Saved {}", path.display()));

        saved.push(SavedFont {
            family: font.info.family.clone(),
            style: font.info.style.clone(),
            weight: font.info.weight.clone(),
            stretch: font.info.stretch.clone(),
            unicode_range: font.info.unicode_range.clone(),
            scripts: font.info.scripts.clone(),
            output_path: path,
            output_format: font.output_format,
            variable_axes_preserved: font.variable_axes_preserved,
            axes: font.axes.clone(),
            scan_source: font.info.scan_source,
            transfer_method: font.transfer_method,
            source_url: font.source_url.clone(),
        });
    }

    Ok(SaveBatch {
        saved,
        failures,
        failure_details,
    })
}

pub(crate) fn build_output_filename(font: &ConvertedFont) -> String {
    if let Some(stem) = font
        .output_stem
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!(
            "{}.{}",
            sanitize_file_stem(stem),
            font.output_format.extension()
        );
    }

    let family = sanitize_file_stem(&font.info.family);
    let weight = sanitize_file_stem(&font.info.weight).to_ascii_lowercase();
    let style = sanitize_file_stem(&font.info.style).to_ascii_lowercase();
    let stretch_suffix = font
        .info
        .stretch
        .as_ref()
        .map(|stretch| {
            format!(
                "-stretch-{}",
                sanitize_file_stem(stretch).to_ascii_lowercase()
            )
        })
        .unwrap_or_default();
    let style_suffix = if matches!(style.as_str(), "normal" | "regular") {
        String::new()
    } else {
        format!("-{style}")
    };
    let variable_suffix = if font.variable_axes_preserved {
        "-Variable"
    } else {
        ""
    };
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
    use crate::domain::{
        ConvertedFont, FontCandidate, FontFormat, FontSource, OutputFormat, ScanSource,
        TransferMethod,
    };

    fn converted_font() -> ConvertedFont {
        ConvertedFont {
            info: FontCandidate {
                id: "id".into(),
                family: "Acme Sans".into(),
                style: "italic".into(),
                weight: "700".into(),
                stretch: None,
                sources: vec![FontSource {
                    url: "https://example.com/font.woff2".into(),
                    format: FontFormat::Woff2,
                }],
                unicode_range: None,
                scripts: vec![],
                variable: false,
                scan_source: ScanSource::StaticCss,
                parts: Vec::new(),
                css_family: None,
            },
            data: vec![],
            output_format: OutputFormat::Ttf,
            variable_axes_preserved: false,
            axes: vec![],
            source_url: "https://example.com/font.woff2".into(),
            transfer_method: TransferMethod::Http,
            output_stem: None,
        }
    }

    #[test]
    fn filename_uses_output_stem_when_set() {
        let mut font = converted_font();
        font.output_stem = Some("GT-Eesti-Bold".into());
        assert_eq!(build_output_filename(&font), "GT-Eesti-Bold.ttf");
    }

    #[test]
    fn filename_reflects_style_and_variable_state() {
        let mut font = converted_font();
        assert_eq!(build_output_filename(&font), "Acme-Sans-700-italic.ttf");
        font.variable_axes_preserved = true;
        font.output_format = OutputFormat::Otf;
        assert_eq!(
            build_output_filename(&font),
            "Acme-Sans-700-italic-Variable.otf"
        );
    }

    #[test]
    fn one_unwritable_font_does_not_abort_the_batch() {
        let directory = tempfile::tempdir().unwrap();
        let mut bad = converted_font();
        // No filesystem accepts a 300-character path component.
        bad.output_stem = Some("A".repeat(300));
        bad.data = vec![1];
        let mut good = converted_font();
        good.data = vec![2];

        let batch =
            save_converted_fonts_report(&[bad.clone(), good.clone()], directory.path(), None)
                .unwrap();
        assert_eq!(batch.saved.len(), 1);
        assert_eq!(std::fs::read(&batch.saved[0].output_path).unwrap(), vec![2]);
        assert_eq!(batch.failures.len(), 1);
        assert_eq!(batch.failure_details[0].0, "id");

        assert_eq!(
            save_converted_fonts(&[bad.clone(), good], directory.path(), None)
                .unwrap()
                .len(),
            1
        );
        assert!(save_converted_fonts(&[bad], directory.path(), None).is_err());
    }

    #[test]
    fn filename_adds_subset_suffix_when_needed() {
        let mut font = converted_font();
        font.info.unicode_range = Some("U+000-5FF".into());
        assert!(build_output_filename(&font).contains("-subset-"));
    }
}
