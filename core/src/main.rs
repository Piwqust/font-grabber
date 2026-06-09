mod app;
mod cli;
mod convert;
mod discovery;
mod domain;
mod fetch;
mod output;
mod support;

use anyhow::Result;
use clap::Parser;

use crate::{
    app::{doctor, grab, scan, serve},
    cli::{Cli, Commands},
};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Grab(args) => grab::run(args).await,
        Commands::Scan(args) => scan::run(args).await,
        Commands::Doctor(args) => doctor::run(args).await,
        Commands::Serve(args) => serve::run(args).await,
    }
}
