use anyhow::{bail, Result};

use crate::{cli::ScanArgs, discovery, domain::ScanRequest, support::{normalize_url, ui}};

pub async fn run(args: ScanArgs) -> Result<()> {
    let interactive = ui::is_interactive_terminal();
    let raw_url = match args.url {
        Some(url) => url,
        None if !args.json && interactive => ui::prompt_for_url()?,
        None => bail!("A URL is required"),
    };

    let page_url = normalize_url(&raw_url)?;
    let logger = if args.json { None } else { Some(ui::human_logger()) };

    let report = discovery::scan(
        &ScanRequest {
            page_url,
            mode: args.mode,
            webdriver_url: args.webdriver_url,
        },
        logger,
    )
    .await?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        ui::print_scan_report(&report);
    }

    Ok(())
}
