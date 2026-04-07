use std::{collections::HashSet, io, path::PathBuf, time::Duration};

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Frame, Terminal,
};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use crate::{
    cli::GrabArgs,
    models::{
        DiscoverRequest, DiscoveredFont, DiscoveryMode, DiscoveryReport, JobState, Logger,
        ProcessRequest, ProcessSummary, ScanSource,
    },
    pipeline::{discover, process_selection},
    util::{default_output_dir, format_bytes, normalize_url, variant_label},
};

type TerminalHandle = Terminal<CrosstermBackend<io::Stdout>>;

#[derive(Debug)]
enum TuiEvent {
    Log(String),
    DiscoveryCompleted(std::result::Result<DiscoveryReport, String>),
    ProcessingCompleted(std::result::Result<ProcessSummary, String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Focus {
    Url,
    Output,
    Mode,
    List,
}

impl Focus {
    fn next(self) -> Self {
        match self {
            Self::Url => Self::Output,
            Self::Output => Self::Mode,
            Self::Mode => Self::List,
            Self::List => Self::Url,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::Output => "output",
            Self::Mode => "mode",
            Self::List => "fonts",
        }
    }
}

struct App {
    url_input: String,
    output_input: String,
    webdriver_url: String,
    mode: DiscoveryMode,
    status: JobState,
    focus: Focus,
    fonts: Vec<DiscoveredFont>,
    selected: HashSet<usize>,
    list_state: ListState,
    logs: Vec<String>,
    should_quit: bool,
    auto_all: bool,
    prefer_browser_fetch: bool,
}

impl App {
    fn new(args: GrabArgs) -> Self {
        let url_input = args.url.unwrap_or_default();
        let output_input = args
            .output
            .map(|value| value.display().to_string())
            .unwrap_or_default();

        Self {
            url_input,
            output_input,
            webdriver_url: args.webdriver_url,
            mode: args.mode,
            status: JobState::Idle,
            focus: Focus::Url,
            fonts: Vec::new(),
            selected: HashSet::new(),
            list_state: ListState::default(),
            logs: vec![
                "Rust rewrite ready.".to_string(),
                "Enter a URL and press Enter to discover fonts.".to_string(),
            ],
            should_quit: false,
            auto_all: args.all,
            prefer_browser_fetch: false,
        }
    }

    fn push_log(&mut self, message: impl Into<String>) {
        self.logs.push(message.into());
        if self.logs.len() > 200 {
            let overflow = self.logs.len() - 200;
            self.logs.drain(0..overflow);
        }
    }

    fn is_busy(&self) -> bool {
        matches!(self.status, JobState::Discovering | JobState::Processing)
    }

    fn selected_fonts(&self) -> Vec<DiscoveredFont> {
        self.fonts
            .iter()
            .enumerate()
            .filter(|(index, _)| self.selected.contains(index))
            .map(|(_, font)| font.clone())
            .collect()
    }

    fn selected_count(&self) -> usize {
        self.selected.len()
    }

    fn active_input_mut(&mut self) -> Option<&mut String> {
        match self.focus {
            Focus::Url => Some(&mut self.url_input),
            Focus::Output => Some(&mut self.output_input),
            _ => None,
        }
    }

    fn start_discovery(&mut self, tx: &UnboundedSender<TuiEvent>) {
        if self.is_busy() {
            return;
        }

        let normalized_url = match normalize_url(&self.url_input) {
            Ok(url) => url,
            Err(error) => {
                self.status = JobState::Error;
                self.push_log(error.to_string());
                return;
            }
        };

        self.url_input = normalized_url.clone();
        if self.output_input.trim().is_empty() {
            self.output_input = default_output_dir(&normalized_url).display().to_string();
        }

        self.status = JobState::Discovering;
        self.fonts.clear();
        self.selected.clear();
        self.list_state.select(None);
        self.push_log(format!("Scanning {}", normalized_url));

        let tx_logs = tx.clone();
        let tx_done = tx.clone();
        let webdriver_url = self.webdriver_url.clone();
        let mode = self.mode;
        let logger: Logger = std::sync::Arc::new(move |message| {
            let _ = tx_logs.send(TuiEvent::Log(message));
        });

        tokio::spawn(async move {
            let result = discover(
                &DiscoverRequest {
                    page_url: normalized_url,
                    mode,
                    webdriver_url,
                },
                Some(logger),
            )
            .await
            .map_err(|error| error.to_string());
            let _ = tx_done.send(TuiEvent::DiscoveryCompleted(result));
        });
    }

    fn start_processing(&mut self, tx: &UnboundedSender<TuiEvent>) {
        if self.is_busy() {
            return;
        }

        let selected_fonts = self.selected_fonts();
        if selected_fonts.is_empty() {
            self.status = JobState::Error;
            self.push_log("Select at least one font before processing.");
            return;
        }

        let normalized_url = match normalize_url(&self.url_input) {
            Ok(url) => url,
            Err(error) => {
                self.status = JobState::Error;
                self.push_log(error.to_string());
                return;
            }
        };

        let output_dir = PathBuf::from(self.output_input.trim());
        self.status = JobState::Processing;
        self.push_log(format!("Saving to {}", output_dir.display()));

        let tx_logs = tx.clone();
        let tx_done = tx.clone();
        let webdriver_url = self.webdriver_url.clone();
        let prefer_browser_fetch = self.prefer_browser_fetch;
        let logger: Logger = std::sync::Arc::new(move |message| {
            let _ = tx_logs.send(TuiEvent::Log(message));
        });

        tokio::spawn(async move {
            let result = process_selection(
                &ProcessRequest {
                    page_url: normalized_url,
                    fonts: selected_fonts,
                    output_dir,
                    prefer_browser_fetch,
                    webdriver_url,
                },
                Some(logger),
            )
            .await
            .map_err(|error| error.to_string());
            let _ = tx_done.send(TuiEvent::ProcessingCompleted(result));
        });
    }

    fn move_selection(&mut self, delta: isize) {
        if self.fonts.is_empty() {
            return;
        }
        let current = self.list_state.selected().unwrap_or(0) as isize;
        let len = self.fonts.len() as isize;
        let next = (current + delta).rem_euclid(len) as usize;
        self.list_state.select(Some(next));
    }

    fn toggle_current(&mut self) {
        let Some(index) = self.list_state.selected() else {
            return;
        };
        if self.selected.contains(&index) {
            self.selected.remove(&index);
        } else {
            self.selected.insert(index);
        }
    }

    fn toggle_all(&mut self) {
        if self.selected.len() == self.fonts.len() {
            self.selected.clear();
        } else {
            self.selected = (0..self.fonts.len()).collect();
        }
    }

    fn handle_background(&mut self, event: TuiEvent) {
        match event {
            TuiEvent::Log(message) => self.push_log(message),
            TuiEvent::DiscoveryCompleted(result) => match result {
                Ok(report) => {
                    let prefer_browser_fetch =
                        report.used_browser || matches!(self.mode, DiscoveryMode::Render);
                    self.fonts = report.fonts;
                    self.prefer_browser_fetch = prefer_browser_fetch;
                    self.status = if self.fonts.is_empty() {
                        JobState::Idle
                    } else {
                        JobState::Reviewing
                    };

                    if self.fonts.is_empty() {
                        self.push_log("No downloadable fonts found.");
                    } else {
                        self.focus = Focus::List;
                        self.list_state.select(Some(0));
                        if self.auto_all {
                            self.selected = (0..self.fonts.len()).collect();
                        }
                        self.push_log(format!("Found {} font variant(s)", self.fonts.len()));
                    }
                }
                Err(error) => {
                    self.status = JobState::Error;
                    self.push_log(error);
                }
            },
            TuiEvent::ProcessingCompleted(result) => match result {
                Ok(summary) => {
                    let crate::models::ProcessSummary {
                        saved,
                        download_failures,
                        conversion_failures,
                    } = summary;
                    self.status = JobState::Done;
                    self.push_log(format!("Saved {} font(s)", saved.len()));
                    for saved in saved {
                        let file_size = saved
                            .output_path
                            .metadata()
                            .map(|meta| meta.len())
                            .unwrap_or(0);
                        self.push_log(format!(
                            "{} [{} · {}]",
                            saved.output_path.display(),
                            saved.converted.output_format.extension(),
                            format_bytes(file_size)
                        ));
                    }

                    for failure in download_failures {
                        self.push_log(format!("Download warning: {failure}"));
                    }
                    for failure in conversion_failures {
                        self.push_log(format!("Conversion warning: {failure}"));
                    }
                }
                Err(error) => {
                    self.status = JobState::Error;
                    self.push_log(error);
                }
            },
        }
    }

    fn cycle_mode(&mut self) {
        self.mode = match self.mode {
            DiscoveryMode::Auto => DiscoveryMode::Static,
            DiscoveryMode::Static => DiscoveryMode::Render,
            DiscoveryMode::Render => DiscoveryMode::Auto,
        };
        self.push_log(format!(
            "Discovery mode set to {} — {}",
            self.mode,
            mode_description(self.mode)
        ));
    }

    fn handle_key(&mut self, key: KeyEvent, tx: &UnboundedSender<TuiEvent>) {
        if key.kind != KeyEventKind::Press {
            return;
        }

        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.should_quit = true;
            return;
        }

        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => {
                self.should_quit = true;
                return;
            }
            _ => {}
        }

        if self.is_busy() {
            return;
        }

        match key.code {
            KeyCode::Tab => {
                self.focus = self.focus.next();
            }
            KeyCode::Char('m') => {
                self.cycle_mode();
            }
            KeyCode::Enter => match self.focus {
                Focus::Url => self.start_discovery(tx),
                Focus::Output => self.start_processing(tx),
                Focus::Mode => self.cycle_mode(),
                Focus::List => self.toggle_current(),
            },
            KeyCode::Up => {
                if matches!(self.focus, Focus::List) {
                    self.move_selection(-1);
                }
            }
            KeyCode::Down => {
                if matches!(self.focus, Focus::List) {
                    self.move_selection(1);
                }
            }
            KeyCode::Char('a') if matches!(self.focus, Focus::List) => self.toggle_all(),
            KeyCode::Char('d') if matches!(self.focus, Focus::List | Focus::Output) => {
                self.start_processing(tx)
            }
            KeyCode::Char(' ') if matches!(self.focus, Focus::List) => self.toggle_current(),
            KeyCode::Backspace => {
                if let Some(input) = self.active_input_mut() {
                    input.pop();
                }
            }
            KeyCode::Char(character) => {
                if let Some(input) = self.active_input_mut() {
                    input.push(character);
                }
            }
            _ => {}
        }
    }
}

pub async fn run(args: GrabArgs) -> Result<()> {
    let mut terminal = setup_terminal()?;
    let (tx, mut rx) = unbounded_channel();
    let mut app = App::new(args);

    if !app.url_input.trim().is_empty() {
        app.start_discovery(&tx);
    }

    let result = run_event_loop(&mut terminal, &mut app, &tx, &mut rx).await;
    let _ = restore_terminal(&mut terminal);
    result
}

async fn run_event_loop(
    terminal: &mut TerminalHandle,
    app: &mut App,
    tx: &UnboundedSender<TuiEvent>,
    rx: &mut UnboundedReceiver<TuiEvent>,
) -> Result<()> {
    while !app.should_quit {
        while let Ok(event) = rx.try_recv() {
            app.handle_background(event);
        }

        terminal.draw(|frame| render(frame, app))?;

        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                app.handle_key(key, tx);
            }
        }
    }

    Ok(())
}

fn render(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4),
            Constraint::Min(12),
            Constraint::Length(11),
        ])
        .split(area);

    render_header(frame, layout[0], app);

    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(44), Constraint::Min(20)])
        .split(layout[1]);

    render_sidebar(frame, body[0], app);
    render_font_list(frame, body[1], app);
    render_logs(frame, layout[2], app);
}

fn render_header(frame: &mut Frame, area: Rect, app: &App) {
    let readiness = if app.is_busy() {
        "working"
    } else if app.fonts.is_empty() {
        "waiting"
    } else {
        "ready"
    };
    let title = Line::from(vec![
        Span::styled(
            " Font Grabber RS ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        Span::styled(format!("{}", app.status.label()), status_style(app.status)),
        Span::raw("  •  "),
        Span::styled(
            format!("mode: {}", app.mode),
            Style::default().fg(Color::LightBlue),
        ),
        Span::raw("  •  "),
        Span::styled(
            format!("selected: {}/{}", app.selected_count(), app.fonts.len()),
            Style::default().fg(Color::White),
        ),
        Span::raw("  •  "),
        Span::styled(
            format!("focus: {}", app.focus.label()),
            Style::default().fg(Color::Gray),
        ),
        Span::raw("  •  "),
        Span::styled(
            readiness,
            Style::default().fg(if app.is_busy() {
                Color::Yellow
            } else if app.fonts.is_empty() {
                Color::Gray
            } else {
                Color::Green
            }),
        ),
    ]);

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Blue));
    frame.render_widget(block, area);
}

fn render_sidebar(frame: &mut Frame, area: Rect, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),
            Constraint::Length(5),
            Constraint::Length(6),
            Constraint::Min(9),
        ])
        .split(area);

    render_input_block(
        frame,
        chunks[0],
        "URL",
        &app.url_input,
        app.focus == Focus::Url,
        "paste website URL",
    );
    render_input_block(
        frame,
        chunks[1],
        "Output Directory",
        &app.output_input,
        app.focus == Focus::Output,
        "output directory",
    );

    let mode_lines = vec![
        Line::from(vec![
            Span::styled("Mode: ", Style::default().fg(Color::Gray)),
            Span::styled(
                app.mode.to_string(),
                Style::default()
                    .fg(Color::LightBlue)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(Span::styled(
            mode_description(app.mode),
            Style::default().fg(Color::Gray),
        )),
        Line::from(vec![
            Span::styled("Browser fetch: ", Style::default().fg(Color::Gray)),
            Span::styled(
                if app.prefer_browser_fetch {
                    "enabled"
                } else {
                    "off"
                },
                Style::default().fg(if app.prefer_browser_fetch {
                    Color::Green
                } else {
                    Color::DarkGray
                }),
            ),
            Span::raw("  •  "),
            Span::styled(browser_fetch_hint(app), Style::default().fg(Color::Gray)),
        ]),
    ];
    let mode_block = Paragraph::new(mode_lines)
        .block(focused_block("Discovery", app.focus == Focus::Mode))
        .wrap(Wrap { trim: false });
    frame.render_widget(mode_block, chunks[2]);

    let help_lines = vec![
        section_heading("Global"),
        Line::from("Tab focus • Q / Ctrl+C quit"),
        section_heading("Inputs"),
        Line::from("Type text • Backspace delete • Enter run"),
        section_heading("Font list"),
        Line::from("↑/↓ move • Space toggle • A all • D save"),
        section_heading("Mode"),
        Line::from("M cycle mode • Enter on mode block"),
        Line::from(format!("WebDriver: {}", app.webdriver_url)),
    ];
    let help = Paragraph::new(help_lines)
        .block(
            Block::default()
                .title("Help")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .wrap(Wrap { trim: false });
    frame.render_widget(help, chunks[3]);
}

fn render_input_block(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    value: &str,
    focused: bool,
    placeholder: &str,
) {
    let line = if value.trim().is_empty() {
        let mut spans = Vec::new();
        if focused {
            spans.push(Span::styled("> ", Style::default().fg(Color::LightBlue)));
        }
        spans.push(Span::styled(
            placeholder,
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::ITALIC),
        ));
        if focused {
            spans.push(Span::styled("_", Style::default().fg(Color::LightBlue)));
        }
        Line::from(spans)
    } else if focused {
        Line::from(vec![
            Span::styled("> ", Style::default().fg(Color::LightBlue)),
            Span::raw(value.to_string()),
            Span::styled("_", Style::default().fg(Color::LightBlue)),
        ])
    } else {
        Line::from(value.to_string())
    };

    let paragraph = Paragraph::new(line)
        .block(focused_block(title, focused))
        .wrap(Wrap { trim: false });
    frame.render_widget(paragraph, area);
}

fn render_font_list(frame: &mut Frame, area: Rect, app: &mut App) {
    let title = format!("Fonts ({}/{})", app.selected_count(), app.fonts.len());
    let block = focused_block(&title, app.focus == Focus::List);

    if app.fonts.is_empty() {
        let placeholder = Paragraph::new(vec![
            Line::from("No fonts discovered yet."),
            Line::from("Press Enter in the URL field to scan."),
            Line::from("Render mode requires a running WebDriver."),
        ])
        .block(block)
        .wrap(Wrap { trim: false });
        frame.render_widget(placeholder, area);
        return;
    }

    let items = app
        .fonts
        .iter()
        .enumerate()
        .map(|(index, font)| {
            let checked = if app.selected.contains(&index) {
                "☑"
            } else {
                "☐"
            };
            let variant = variant_label(&font.weight, &font.style);
            let formats = font
                .sources
                .iter()
                .map(|source| source.format.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let source = match font.scan_source {
                ScanSource::StaticCss => "static css",
                ScanSource::BrowserCss => "browser css",
            };
            let variable_badge = if font.is_variable {
                Span::styled(
                    " variable ",
                    Style::default()
                        .fg(Color::Green)
                        .add_modifier(Modifier::BOLD),
                )
            } else {
                Span::styled(" static ", Style::default().fg(Color::DarkGray))
            };
            ListItem::new(vec![
                Line::from(vec![
                    Span::styled(
                        format!("{checked} "),
                        Style::default().fg(Color::LightGreen),
                    ),
                    Span::styled(
                        font.family.clone(),
                        Style::default()
                            .fg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("  "),
                    Span::styled(variant, Style::default().fg(Color::LightBlue)),
                    Span::raw("  "),
                    variable_badge,
                ]),
                Line::from(vec![
                    Span::styled("    formats ", Style::default().fg(Color::DarkGray)),
                    Span::styled(formats, Style::default().fg(Color::Gray)),
                    Span::raw("  •  "),
                    Span::styled(source, Style::default().fg(Color::DarkGray)),
                ]),
            ])
        })
        .collect::<Vec<_>>();

    let list = List::new(items)
        .block(block)
        .highlight_style(
            Style::default()
                .bg(Color::Rgb(35, 44, 72))
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("› ");
    frame.render_stateful_widget(list, area, &mut app.list_state);
}

fn render_logs(frame: &mut Frame, area: Rect, app: &App) {
    let capacity = area.height.saturating_sub(2) as usize;
    let visible_logs = app
        .logs
        .iter()
        .rev()
        .take(capacity)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();

    let last_index = visible_logs.len().saturating_sub(1);
    let lines = visible_logs
        .iter()
        .enumerate()
        .map(|(index, message)| {
            let style = log_style(message, index == last_index);
            Line::from(Span::styled(message.clone(), style))
        })
        .collect::<Vec<_>>();

    let logs = Paragraph::new(lines)
        .block(
            Block::default()
                .title(format!("Logs ({})", app.logs.len()))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .wrap(Wrap { trim: false });
    frame.render_widget(logs, area);
}

fn focused_block(title: &str, focused: bool) -> Block<'_> {
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(if focused {
            Style::default().fg(Color::LightBlue)
        } else {
            Style::default().fg(Color::DarkGray)
        })
}

fn mode_description(mode: DiscoveryMode) -> &'static str {
    match mode {
        DiscoveryMode::Auto => "Start with static CSS, escalate to browser only when needed.",
        DiscoveryMode::Static => "Fastest path. Only parse fetched HTML and stylesheets.",
        DiscoveryMode::Render => "Use WebDriver and inspect live CSSOM for JS-rendered pages.",
    }
}

fn browser_fetch_hint(app: &App) -> &'static str {
    if app.prefer_browser_fetch {
        "browser context active"
    } else if matches!(app.mode, DiscoveryMode::Render) {
        "will prefer browser after render scan"
    } else {
        "direct HTTP until needed"
    }
}

fn section_heading(title: &str) -> Line<'static> {
    Line::from(Span::styled(
        title.to_string(),
        Style::default()
            .fg(Color::LightBlue)
            .add_modifier(Modifier::BOLD),
    ))
}

fn log_style(message: &str, is_latest: bool) -> Style {
    let lower = message.to_ascii_lowercase();
    let base = if lower.contains("error") || lower.contains("failed") {
        Style::default().fg(Color::Red)
    } else if lower.contains("warning") {
        Style::default().fg(Color::Yellow)
    } else if lower.contains("saved") || lower.contains("done") {
        Style::default().fg(Color::Green)
    } else if lower.contains("scan") || lower.contains("discover") {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::Gray)
    };

    if is_latest {
        base.add_modifier(Modifier::BOLD)
    } else {
        base
    }
}

fn status_style(status: JobState) -> Style {
    match status {
        JobState::Idle => Style::default().fg(Color::Gray),
        JobState::Discovering | JobState::Processing => Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
        JobState::Reviewing => Style::default()
            .fg(Color::LightBlue)
            .add_modifier(Modifier::BOLD),
        JobState::Done => Style::default()
            .fg(Color::Green)
            .add_modifier(Modifier::BOLD),
        JobState::Error => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
    }
}

fn setup_terminal() -> io::Result<TerminalHandle> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend)
}

fn restore_terminal(terminal: &mut TerminalHandle) -> io::Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}
