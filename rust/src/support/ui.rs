use std::{collections::BTreeMap, io::{stdin, stdout, IsTerminal}, sync::Arc};

use anyhow::Result;
use console::style;
use dialoguer::{theme::ColorfulTheme, Input, MultiSelect};

use crate::{
    domain::{DoctorReport, FontCandidate, GrabReport, ScanReport},
    support::{variant_label, Logger},
};

pub fn is_interactive_terminal() -> bool {
    stdin().is_terminal() && stdout().is_terminal()
}

pub fn prompt_for_url() -> Result<String> {
    Ok(Input::with_theme(&ColorfulTheme::default())
        .with_prompt("Website URL")
        .interact_text()?)
}

pub fn prompt_for_fonts(fonts: &[FontCandidate]) -> Result<Vec<FontCandidate>> {
    let items = fonts.iter().map(selection_label).collect::<Vec<_>>();
    let defaults = vec![true; items.len()];
    let indices = MultiSelect::with_theme(&ColorfulTheme::default())
        .with_prompt("Select fonts to save")
        .items(&items)
        .defaults(&defaults)
        .interact()?;

    Ok(indices.into_iter().map(|index| fonts[index].clone()).collect())
}

pub fn human_logger() -> Logger {
    Arc::new(|message| {
        println!("{} {}", style("•").dim(), style(message).dim());
    })
}

pub fn print_scan_report(report: &ScanReport) {
    print_title("Scan");
    println!("{} {}", style("URL").dim(), report.page_url);
    println!("{} {}", style("Mode").dim(), report.mode);
    println!("{} {}", style("Fonts").dim(), report.fonts.len());
    println!(
        "{} {}",
        style("Engine").dim(),
        if report.used_browser { "static + browser" } else { "static" }
    );

    if !report.warnings.is_empty() {
        print_messages("Warnings", &report.warnings, true);
    }

    if report.fonts.is_empty() {
        println!("\n{}", style("No downloadable fonts found.").yellow());
        return;
    }

    let mut grouped = BTreeMap::<String, Vec<&FontCandidate>>::new();
    for font in &report.fonts {
        grouped.entry(font.family.clone()).or_default().push(font);
    }

    println!();
    for (family, fonts) in grouped {
        println!("{}", style(family).bold());
        for font in fonts {
            println!(
                "  {}  {}  {}  {}",
                style(variant_label(&font.weight, &font.style, font.stretch.as_deref(), font.variable)).cyan(),
                style(format_sources(font)).dim(),
                style(font.scan_source.label()).dim(),
                style(subset_badge(font)).dim(),
            );
        }
        println!();
    }
}

pub fn print_grab_report(report: &GrabReport) {
    print_title("Saved");
    println!("{} {}", style("URL").dim(), report.page_url);
    println!("{} {}", style("Selected").dim(), report.selected_count);
    println!("{} {}", style("Saved").dim(), style(report.saved_count).green());
    println!("{} {}", style("Output").dim(), report.output_dir.display());

    if !report.saved.is_empty() {
        println!();
        for saved in &report.saved {
            println!(
                "{} {} {}",
                style("•").green(),
                style(format!("{} — {}", saved.family, variant_label(&saved.weight, &saved.style, saved.stretch.as_deref(), saved.variable_axes_preserved))).bold(),
                style(saved.output_path.display()).dim(),
            );
        }
    }

    if !report.warnings.is_empty() {
        print_messages("Warnings", &report.warnings, true);
    }
    if !report.download_failures.is_empty() {
        print_messages("Download issues", &report.download_failures, true);
    }
    if !report.conversion_failures.is_empty() {
        print_messages("Conversion issues", &report.conversion_failures, true);
    }
}

pub fn print_doctor_report(report: &DoctorReport) {
    print_title("Doctor");
    println!("{} {}", style("WebDriver").dim(), report.webdriver_url);
    println!("{} {}", style("Status").dim(), status_text(report.status_ok));
    println!("{} {}", style("Session").dim(), status_text(report.session_ok));
    println!("{} {}", style("Script").dim(), status_text(report.script_ok));
}

fn print_title(title: &str) {
    println!("\n{}\n", style(title).bold().cyan());
}

fn print_messages(title: &str, messages: &[String], warning: bool) {
    println!("\n{}", style(title).bold());
    for message in messages {
        let bullet = if warning { style("!").yellow() } else { style("•").dim() };
        println!("{} {}", bullet, message);
    }
}

fn selection_label(font: &FontCandidate) -> String {
    format!(
        "{} — {} — {} — {}{}",
        font.family,
        variant_label(&font.weight, &font.style, font.stretch.as_deref(), font.variable),
        format_sources(font),
        font.scan_source.label(),
        subset_suffix(font)
    )
}

fn format_sources(font: &FontCandidate) -> String {
    let mut labels = Vec::<&str>::new();
    for source in &font.sources {
        let label = source.format.label();
        if !labels.contains(&label) {
            labels.push(label);
        }
    }
    labels.join(", ")
}

fn subset_badge(font: &FontCandidate) -> String {
    font.unicode_range
        .as_ref()
        .map(|_| "subset".to_string())
        .unwrap_or_default()
}

fn subset_suffix(font: &FontCandidate) -> String {
    if font.unicode_range.is_some() {
        " — subset".to_string()
    } else {
        String::new()
    }
}

fn status_text(value: bool) -> console::StyledObject<&'static str> {
    if value {
        style("ok").green()
    } else {
        style("failed").red()
    }
}
