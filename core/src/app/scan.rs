use anyhow::{bail, Result};

use crate::{
    cli::ScanArgs,
    discovery,
    domain::ScanRequest,
    support::{family_names, filter_families, normalize_url, ui},
};

pub async fn run(args: ScanArgs) -> Result<()> {
    let interactive = ui::is_interactive_terminal();
    let raw_url = match args.url {
        Some(url) => url,
        None if !args.json && interactive => ui::prompt_for_url()?,
        None => bail!("A URL is required"),
    };

    let page_url = normalize_url(&raw_url)?;
    let logger = if args.json {
        None
    } else {
        Some(ui::human_logger())
    };

    let mut report = discovery::scan(
        &ScanRequest {
            page_url,
            mode: args.mode,
            enrich_scripts: true,
        },
        logger,
    )
    .await?;
    if !args.only.is_empty() {
        let families = family_names(&report.fonts);
        report.fonts = filter_families(std::mem::take(&mut report.fonts), &args.only);
        if report.fonts.is_empty() && !families.is_empty() {
            report.warnings.push(format!(
                "No family matches {}. Found: {}",
                args.only.join(", "),
                families.join(", ")
            ));
        }
    }

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        ui::print_scan_report(&report);
    }

    Ok(())
}
