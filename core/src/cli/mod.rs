use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

use crate::domain::DiscoveryMode;

#[derive(Parser, Debug)]
#[command(
    name = "font-grabber",
    version,
    about = "Discover website type and save clean TTF/OTF files",
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
    Serve(ServeArgs),
    /// Create an Argon2id hash. Reads the password privately from the terminal.
    PasswordHash,
}

#[derive(Args, Debug, Clone)]
pub struct GrabArgs {
    #[arg(help = "Website URL to scan")]
    pub url: Option<String>,

    #[arg(short, long, help = "Output directory for converted fonts")]
    pub output: Option<PathBuf>,

    #[arg(
        short = 'a',
        long,
        help = "Save every discovered font without prompting"
    )]
    pub all: bool,

    #[arg(long, value_enum, default_value_t = DiscoveryMode::Auto, help = "Discovery strategy")]
    pub mode: DiscoveryMode,

    /// Ignored. Fount starts its own headless Chrome; kept so older scripts
    /// that still pass it keep working.
    #[arg(long, hide = true)]
    pub webdriver_url: Option<String>,

    #[arg(
        long,
        default_value_t = 6,
        value_parser = parse_concurrency,
        help = "Maximum concurrent HTTP downloads"
    )]
    pub concurrency: usize,

    #[arg(long, help = "Print machine-readable JSON")]
    pub json: bool,

    #[arg(
        long,
        value_name = "FAMILY",
        help = "Keep only families whose name contains this text (repeatable, case and spacing ignored)"
    )]
    pub only: Vec<String>,

    #[arg(long, help = "Overwrite the OpenType family name on every saved face")]
    pub family: Option<String>,

    #[arg(
        long,
        help = "Overwrite the OpenType subfamily (style) on every saved face"
    )]
    pub subfamily: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct ScanArgs {
    #[arg(help = "Website URL to scan")]
    pub url: Option<String>,

    #[arg(long, value_enum, default_value_t = DiscoveryMode::Auto, help = "Discovery strategy")]
    pub mode: DiscoveryMode,

    /// Ignored. Fount starts its own headless Chrome; kept so older scripts
    /// that still pass it keep working.
    #[arg(long, hide = true)]
    pub webdriver_url: Option<String>,

    #[arg(long, help = "Print machine-readable JSON")]
    pub json: bool,

    #[arg(
        long,
        value_name = "FAMILY",
        help = "Keep only families whose name contains this text (repeatable, case and spacing ignored)"
    )]
    pub only: Vec<String>,
}

#[derive(Args, Debug, Clone)]
pub struct ServeArgs {
    #[arg(long, default_value_t = 8787, help = "Port for the local web server")]
    pub port: u16,

    #[arg(
        long,
        default_value = "127.0.0.1",
        help = "Address to bind (keep on localhost for local-only use)"
    )]
    pub host: String,

    /// Ignored. Fount starts its own headless Chrome; kept so older scripts
    /// that still pass it keep working.
    #[arg(long, hide = true)]
    pub webdriver_url: Option<String>,

    #[arg(
        long,
        default_value_t = 6,
        value_parser = parse_concurrency,
        help = "Maximum concurrent HTTP downloads"
    )]
    pub concurrency: usize,

    #[arg(long, help = "Do not open the browser automatically")]
    pub no_open: bool,

    #[arg(
        long,
        help = "Hosted mode: ZIP only, block private-network fetches, disable folder delivery"
    )]
    pub hosted: bool,

    #[arg(long, default_value = "/run/secrets/fount_password_hash")]
    pub password_hash_file: PathBuf,

    /// Exact external HTTPS origin, required in hosted mode.
    #[arg(long)]
    pub public_origin: Option<String>,

    /// Exact address of the TLS proxy allowed to supply forwarding headers.
    #[arg(long)]
    pub trusted_proxy: Option<std::net::IpAddr>,
}

#[derive(Args, Debug, Clone)]
pub struct DoctorArgs {
    /// Ignored. Fount starts its own headless Chrome; kept so older scripts
    /// that still pass it keep working.
    #[arg(long, hide = true)]
    pub webdriver_url: Option<String>,

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
