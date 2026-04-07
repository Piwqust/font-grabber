use std::{fs, path::Path};

use anyhow::{Context, Result};

use crate::{
    models::{ConvertedFont, Logger, SavedFont},
    util::{emit_log, next_available_path, sanitize_family_dir},
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
        let family_dir = sanitize_family_dir(&font.info.family);
        let target_dir = output_dir.join(if family_dir.is_empty() {
            "Font"
        } else {
            family_dir.as_str()
        });
        fs::create_dir_all(&target_dir).with_context(|| {
            format!("Failed to create family directory {}", target_dir.display())
        })?;

        let path = next_available_path(&target_dir.join(&font.filename));
        fs::write(&path, &font.data)
            .with_context(|| format!("Failed to write converted font {}", path.display()))?;

        emit_log(logger.as_ref(), format!("Saved {}", path.display()));

        saved.push(SavedFont {
            converted: font.clone(),
            output_path: path,
        });
    }

    Ok(saved)
}
