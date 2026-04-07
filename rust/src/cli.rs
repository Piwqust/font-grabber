use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

use crate::models::DiscoveryMode;

#[derive(Parser, Debug)]
#[command(
    name = "font-grabber-rs",
    version,
    about = "Grab fonts from websites and convert them to TTF/OTF",
    propagate_version = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    Grab(GrabArgs),
    Doctor(DoctorArgs),
}

#[derive(Args, Debug, Clone)]
pub struct GrabArgs {
    #[arg(long, help = "Website URL to scan")]
    pub url: Option<String>,

    #[arg(short, long, help = "Output directory for converted fonts")]
    pub output: Option<PathBuf>,

    #[arg(short = 'a', long, help = "Auto-select all discovered fonts")]
    pub all: bool,

    #[arg(long, value_enum, default_value_t = DiscoveryMode::Auto, help = "Discovery strategy")]
    pub mode: DiscoveryMode,

    #[arg(
        long,
        default_value = "http://localhost:4444",
        help = "WebDriver endpoint used for render mode"
    )]
    pub webdriver_url: String,

    #[arg(
        long,
        help = "Run without the interactive TUI (requires --url and --all)"
    )]
    pub no_ui: bool,
}

impl Default for GrabArgs {
    fn default() -> Self {
        Self {
            url: None,
            output: None,
            all: false,
            mode: DiscoveryMode::Auto,
            webdriver_url: "http://localhost:4444".to_string(),
            no_ui: false,
        }
    }
}

#[derive(Args, Debug, Clone)]
pub struct DoctorArgs {
    #[arg(
        long,
        default_value = "http://localhost:4444",
        help = "WebDriver endpoint to probe"
    )]
    pub webdriver_url: String,
}
