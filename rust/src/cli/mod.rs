use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

use crate::domain::DiscoveryMode;

#[derive(Parser, Debug)]
#[command(
    name = "font-grabber",
    version,
    about = "Scrape website fonts and save clean TTF/OTF files",
    propagate_version = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    Grab(GrabArgs),
    Scan(ScanArgs),
    Doctor(DoctorArgs),
}

#[derive(Args, Debug, Clone)]
pub struct GrabArgs {
    #[arg(help = "Website URL to scan")]
    pub url: Option<String>,

    #[arg(short, long, help = "Output directory for converted fonts")]
    pub output: Option<PathBuf>,

    #[arg(short = 'a', long, help = "Save every discovered font without prompting")]
    pub all: bool,

    #[arg(long, value_enum, default_value_t = DiscoveryMode::Auto, help = "Discovery strategy")]
    pub mode: DiscoveryMode,

    #[arg(
        long,
        default_value = "http://localhost:4444",
        help = "WebDriver endpoint used for render mode and browser fallback"
    )]
    pub webdriver_url: String,

    #[arg(
        long,
        default_value_t = 6,
        value_parser = parse_concurrency,
        help = "Maximum concurrent HTTP downloads"
    )]
    pub concurrency: usize,

    #[arg(long, help = "Print machine-readable JSON")]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct ScanArgs {
    #[arg(help = "Website URL to scan")]
    pub url: Option<String>,

    #[arg(long, value_enum, default_value_t = DiscoveryMode::Auto, help = "Discovery strategy")]
    pub mode: DiscoveryMode,

    #[arg(
        long,
        default_value = "http://localhost:4444",
        help = "WebDriver endpoint used for render mode"
    )]
    pub webdriver_url: String,

    #[arg(long, help = "Print machine-readable JSON")]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct DoctorArgs {
    #[arg(
        long,
        default_value = "http://localhost:4444",
        help = "WebDriver endpoint to probe"
    )]
    pub webdriver_url: String,

    #[arg(long, help = "Print machine-readable JSON")]
    pub json: bool,
}

fn parse_concurrency(value: &str) -> Result<usize, String> {
    let parsed = value
        .parse::<usize>()
        .map_err(|_| "Concurrency must be a whole number".to_string())?;

    if (1..=32).contains(&parsed) {
        Ok(parsed)
    } else {
        Err("Concurrency must be between 1 and 32".to_string())
    }
}
