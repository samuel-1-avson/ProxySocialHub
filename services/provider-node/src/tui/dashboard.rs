use crate::doctor::{Check, DoctorReport};
use crate::operator::OperatorSnapshot;
use crate::tui::theme::{self, retro_block, status_badge};
use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Gauge, Paragraph, Row, Sparkline, Table, Wrap};
use std::io::stdout;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const SPARK_LEN: usize = 48;
const LOG_PAGE: usize = 8;
/// Control API + earnings poll interval (ms).
const REMOTE_REFRESH_MS: u64 = 10_000;
/// Pre-flight doctor re-run interval (ms).
const DOCTOR_REFRESH_MS: u64 = 15_000;
const HEARTBEAT_STALE_MS: u64 = 90_000;
/// Target UI frame rate (~30 fps) so keys and tab blink feel responsive.
const FRAME_MS: u64 = 33;
const HINT_TICKS: u64 = 75;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Overview = 0,
    Network = 1,
    Nodes = 2,
    Earnings = 3,
    Logs = 4,
}

impl Tab {
    const ALL: [Tab; 5] = [
        Tab::Overview,
        Tab::Network,
        Tab::Nodes,
        Tab::Earnings,
        Tab::Logs,
    ];

    fn label(self) -> &'static str {
        match self {
            Tab::Overview => "01 OVERVIEW",
            Tab::Network => "02 NETWORK",
            Tab::Nodes => "03 NODES",
            Tab::Earnings => "04 EARNINGS",
            Tab::Logs => "05 LOGS",
        }
    }

    fn next(self) -> Tab {
        let i = self as usize;
        Tab::ALL[(i + 1) % Tab::ALL.len()]
    }

    fn prev(self) -> Tab {
        let i = self as usize;
        Tab::ALL[(i + Tab::ALL.len() - 1) % Tab::ALL.len()]
    }
}

struct DashboardApp {
    tab: Tab,
    log_scroll: usize,
    node_cursor: usize,
    tick: u64,
    show_help: bool,
    force_refresh: bool,
    force_doctor: bool,
    hint: Option<(String, u64)>,
    spark_up: Vec<u64>,
    spark_down: Vec<u64>,
}

struct DashboardData {
    snapshot: Option<OperatorSnapshot>,
    local_error: Option<String>,
    remote_error: Option<String>,
    doctor: Option<DoctorReport>,
    doctor_error: Option<String>,
}

struct RefreshInFlight {
    local: bool,
    remote: bool,
    doctor: bool,
}

enum RefreshMsg {
    Local(Result<OperatorSnapshot, String>),
    Remote(Result<OperatorSnapshot, String>),
    Doctor(Result<DoctorReport, String>),
}

#[derive(PartialEq)]
enum LoopAction {
    Continue,
    Quit,
}

impl DashboardApp {
    fn new() -> Self {
        Self {
            tab: Tab::Overview,
            log_scroll: 0,
            node_cursor: 0,
            tick: 0,
            show_help: false,
            force_refresh: false,
            force_doctor: false,
            hint: None,
            spark_up: Vec::with_capacity(SPARK_LEN),
            spark_down: Vec::with_capacity(SPARK_LEN),
        }
    }

    fn push_spark(&mut self, up: u32, down: u32) {
        push_sample(&mut self.spark_up, up as u64);
        push_sample(&mut self.spark_down, down as u64);
    }
}

fn push_sample(buf: &mut Vec<u64>, v: u64) {
    buf.push(v);
    if buf.len() > SPARK_LEN {
        buf.remove(0);
    }
}

pub async fn run(config_path: PathBuf, refresh_ms: u64) -> Result<()> {
    let mut stdout = stdout();
    enable_raw_mode()?;
    stdout.execute(EnterAlternateScreen)?;
    let mut terminal = ratatui::init();

    let local_refresh = Duration::from_millis(refresh_ms.max(250));
    let remote_refresh = Duration::from_millis(REMOTE_REFRESH_MS);
    let doctor_refresh = Duration::from_millis(DOCTOR_REFRESH_MS);
    let frame_interval = Duration::from_millis(FRAME_MS);

    let mut app = DashboardApp::new();
    let mut data = DashboardData {
        snapshot: None,
        local_error: None,
        remote_error: None,
        doctor: None,
        doctor_error: None,
    };
    let mut in_flight = RefreshInFlight {
        local: false,
        remote: false,
        doctor: false,
    };

    let (refresh_tx, mut refresh_rx) = mpsc::unbounded_channel::<RefreshMsg>();

    let mut last_local = Instant::now() - local_refresh;
    let mut last_remote = Instant::now() - remote_refresh;
    let mut last_doctor = Instant::now() - doctor_refresh;

    let mut frame_timer = tokio::time::interval(frame_interval);
    frame_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        frame_timer.tick().await;

        let force = app.force_refresh;
        let force_doctor = app.force_doctor;
        app.force_refresh = false;
        app.force_doctor = false;

        drain_refresh_messages(&mut refresh_rx, &mut app, &mut data, &mut in_flight);

        let now = Instant::now();
        schedule_refreshes(
            &config_path,
            &refresh_tx,
            &mut in_flight,
            &data.snapshot,
            force,
            force_doctor,
            now,
            &mut last_local,
            &mut last_remote,
            &mut last_doctor,
            local_refresh,
            remote_refresh,
            doctor_refresh,
        );

        app.tick = app.tick.wrapping_add(1);
        draw_dashboard(&mut terminal, refresh_ms, &app, &data, &in_flight)?;

        while event::poll(Duration::from_millis(0))? {
            let action = match event::read()? {
                Event::Key(key) => {
                    if key.kind != KeyEventKind::Press {
                        LoopAction::Continue
                    } else {
                        handle_key_event(&mut app, &data, key.code, key.modifiers)?
                    }
                }
                Event::Resize(_, _) => LoopAction::Continue,
                _ => LoopAction::Continue,
            };
            draw_dashboard(&mut terminal, refresh_ms, &app, &data, &in_flight)?;
            if action == LoopAction::Quit {
                disable_raw_mode()?;
                stdout.execute(LeaveAlternateScreen)?;
                ratatui::restore();
                return Ok(());
            }
        }
    }
}

fn draw_dashboard(
    terminal: &mut ratatui::DefaultTerminal,
    refresh_ms: u64,
    app: &DashboardApp,
    data: &DashboardData,
    in_flight: &RefreshInFlight,
) -> Result<()> {
    let alerts = collect_alerts(
        data.snapshot.as_ref(),
        data.local_error.as_deref(),
        data.remote_error.as_deref(),
        data.doctor.as_ref(),
        data.doctor_error.as_deref(),
    );
    let alert_h = if alerts.is_empty() { 0 } else { 2 };

    terminal.draw(|frame| {
        frame.render_widget(
            Paragraph::new("").style(Style::default().bg(theme::BG)),
            frame.area(),
        );
        let area = frame.area();
        let layout = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(5),
                Constraint::Length(alert_h),
                Constraint::Length(3),
                Constraint::Min(10),
                Constraint::Length(3),
            ])
            .split(area);

        let mut idx = 0;
        render_banner(
            frame,
            layout[idx],
            data.snapshot.as_ref(),
            data.local_error.as_deref(),
            app.tick,
        );
        idx += 1;
        if alert_h > 0 {
            render_alert_strip(frame, layout[idx], &alerts, app.tick);
            idx += 1;
        }
        render_tab_bar(frame, layout[idx], app);
        idx += 1;
        render_body(
            frame,
            layout[idx],
            app,
            data.snapshot.as_ref(),
            data.local_error.as_deref(),
            data.doctor.as_ref(),
            data.doctor_error.as_deref(),
        );
        idx += 1;
        render_command_bar(frame, layout[idx], refresh_ms, app, &sync_hint(in_flight));

        if app.show_help {
            render_help_overlay(frame, area);
        }
    })?;
    Ok(())
}

fn sync_hint(in_flight: &RefreshInFlight) -> String {
    let mut parts = Vec::new();
    if in_flight.local {
        parts.push("local");
    }
    if in_flight.remote {
        parts.push("remote");
    }
    if in_flight.doctor {
        parts.push("doctor");
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" syncing {}", parts.join("+"))
    }
}

fn set_hint(app: &mut DashboardApp, message: impl Into<String>) {
    app.hint = Some((message.into(), app.tick));
}

fn active_hint(app: &DashboardApp) -> Option<&str> {
    app.hint.as_ref().and_then(|(msg, at)| {
        if app.tick.saturating_sub(*at) <= HINT_TICKS {
            Some(msg.as_str())
        } else {
            None
        }
    })
}

fn drain_refresh_messages(
    rx: &mut mpsc::UnboundedReceiver<RefreshMsg>,
    app: &mut DashboardApp,
    data: &mut DashboardData,
    in_flight: &mut RefreshInFlight,
) {
    while let Ok(msg) = rx.try_recv() {
        match msg {
            RefreshMsg::Local(result) => {
                in_flight.local = false;
                match result {
                    Ok(local) => {
                        data.local_error = None;
                        if let Some(m) = &local.status.metrics {
                            app.push_spark(m.rate_up_kbps, m.rate_down_kbps);
                        }
                        match &mut data.snapshot {
                            Some(existing) => merge_local(existing, &local),
                            None => data.snapshot = Some(local),
                        }
                    }
                    Err(e) => data.local_error = Some(e),
                }
            }
            RefreshMsg::Remote(result) => {
                in_flight.remote = false;
                match result {
                    Ok(snap) => {
                        data.remote_error = None;
                        data.snapshot = Some(snap);
                        clamp_node_cursor(app, &data.snapshot);
                    }
                    Err(e) => data.remote_error = Some(e),
                }
            }
            RefreshMsg::Doctor(result) => {
                in_flight.doctor = false;
                match result {
                    Ok(report) => {
                        data.doctor = Some(report);
                        data.doctor_error = None;
                    }
                    Err(e) => data.doctor_error = Some(e),
                }
            }
        }
    }
}

fn clamp_node_cursor(app: &mut DashboardApp, snapshot: &Option<OperatorSnapshot>) {
    if let Some(s) = snapshot {
        let n = s.status.control_api.nodes.len();
        if n > 0 && app.node_cursor >= n {
            app.node_cursor = n - 1;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn schedule_refreshes(
    config_path: &std::path::Path,
    tx: &mpsc::UnboundedSender<RefreshMsg>,
    in_flight: &mut RefreshInFlight,
    snapshot: &Option<OperatorSnapshot>,
    force: bool,
    force_doctor: bool,
    now: Instant,
    last_local: &mut Instant,
    last_remote: &mut Instant,
    last_doctor: &mut Instant,
    local_refresh: Duration,
    remote_refresh: Duration,
    doctor_refresh: Duration,
) {
    if !in_flight.local && (force || now.duration_since(*last_local) >= local_refresh) {
        in_flight.local = true;
        *last_local = now;
        let path = config_path.to_path_buf();
        let tx = tx.clone();
        tokio::spawn(async move {
            let msg = match crate::operator::collect_local(path).await {
                Ok(s) => RefreshMsg::Local(Ok(s)),
                Err(e) => RefreshMsg::Local(Err(e.to_string())),
            };
            let _ = tx.send(msg);
        });
    }

    if !in_flight.remote
        && snapshot.is_some()
        && (force || now.duration_since(*last_remote) >= remote_refresh)
    {
        in_flight.remote = true;
        *last_remote = now;
        let path = config_path.to_path_buf();
        let tx = tx.clone();
        let snap = snapshot.clone().expect("checked is_some");
        tokio::spawn(async move {
            let mut snap = snap;
            let msg = match crate::operator::refresh_remote(&mut snap, path).await {
                Ok(()) => RefreshMsg::Remote(Ok(snap)),
                Err(e) => RefreshMsg::Remote(Err(e.to_string())),
            };
            let _ = tx.send(msg);
        });
    }

    if !in_flight.doctor
        && (force || force_doctor || now.duration_since(*last_doctor) >= doctor_refresh)
    {
        in_flight.doctor = true;
        *last_doctor = now;
        let path = config_path.to_path_buf();
        let tx = tx.clone();
        tokio::spawn(async move {
            let msg = match crate::doctor::run(path).await {
                Ok(r) => RefreshMsg::Doctor(Ok(r)),
                Err(e) => RefreshMsg::Doctor(Err(e.to_string())),
            };
            let _ = tx.send(msg);
        });
    }
}

fn handle_key_event(
    app: &mut DashboardApp,
    data: &DashboardData,
    code: KeyCode,
    modifiers: KeyModifiers,
) -> Result<LoopAction> {
    if app.show_help {
        match code {
            KeyCode::Char('?') | KeyCode::Esc | KeyCode::Enter => {
                app.show_help = false;
                set_hint(app, "Help closed — press ? anytime");
            }
            KeyCode::Char('q') => return Ok(LoopAction::Quit),
            _ => set_hint(app, "Close help with Esc, Enter, or ?"),
        }
        return Ok(LoopAction::Continue);
    }

    match code {
        KeyCode::Char('q') | KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
            return Ok(LoopAction::Quit);
        }
        KeyCode::Char('q') | KeyCode::Esc => return Ok(LoopAction::Quit),
        KeyCode::Char('?') => {
            app.show_help = true;
            set_hint(app, "Help open");
        }
        KeyCode::Char('r') => {
            app.force_refresh = true;
            set_hint(app, "Syncing local + remote…");
        }
        KeyCode::Char('d') => {
            app.force_doctor = true;
            set_hint(app, "Running doctor checks…");
        }
        KeyCode::Tab => {
            app.tab = app.tab.next();
            set_hint(app, format!("Tab → {}", app.tab.label().trim()));
        }
        KeyCode::BackTab => {
            app.tab = app.tab.prev();
            set_hint(app, format!("Tab → {}", app.tab.label().trim()));
        }
        KeyCode::Char(c) if ('1'..='5').contains(&c) => {
            app.tab = Tab::ALL[(c as usize) - ('1' as usize)];
            set_hint(app, format!("Tab → {}", app.tab.label().trim()));
        }
        KeyCode::Right | KeyCode::Char('l') => {
            app.tab = app.tab.next();
            set_hint(app, format!("Tab → {}", app.tab.label().trim()));
        }
        KeyCode::Left | KeyCode::Char('h') => {
            app.tab = app.tab.prev();
            set_hint(app, format!("Tab → {}", app.tab.label().trim()));
        }
        KeyCode::Down | KeyCode::Char('j') | KeyCode::PageDown => match app.tab {
            Tab::Logs => {
                let step = if matches!(code, KeyCode::PageDown) {
                    LOG_PAGE
                } else {
                    1
                };
                app.log_scroll = app.log_scroll.saturating_add(step);
                set_hint(app, "Logs ↓");
            }
            Tab::Nodes => {
                app.node_cursor = app.node_cursor.saturating_add(1);
                clamp_node_cursor(app, &data.snapshot);
                set_hint(app, "Node ↓");
            }
            other => set_hint(app, format!("j/k scroll on {} tab only", tab_short(other))),
        },
        KeyCode::Up | KeyCode::Char('k') | KeyCode::PageUp => match app.tab {
            Tab::Logs => {
                let step = if matches!(code, KeyCode::PageUp) {
                    LOG_PAGE
                } else {
                    1
                };
                app.log_scroll = app.log_scroll.saturating_sub(step);
                set_hint(app, "Logs ↑");
            }
            Tab::Nodes => {
                app.node_cursor = app.node_cursor.saturating_sub(1);
                set_hint(app, "Node ↑");
            }
            other => set_hint(app, format!("j/k scroll on {} tab only", tab_short(other))),
        },
        KeyCode::Home | KeyCode::Char('g') => {
            app.log_scroll = 0;
            app.node_cursor = 0;
            set_hint(app, "Top");
        }
        KeyCode::End | KeyCode::Char('G') => {
            if let Some(s) = &data.snapshot {
                if app.tab == Tab::Logs {
                    let n = s.log_tail.len().saturating_sub(LOG_PAGE);
                    app.log_scroll = n;
                }
                if app.tab == Tab::Nodes {
                    let n = s.status.control_api.nodes.len();
                    app.node_cursor = n.saturating_sub(1);
                }
            }
            set_hint(app, "Bottom");
        }
        _ => set_hint(app, "Unknown key — press ? for help"),
    }
    Ok(LoopAction::Continue)
}

fn tab_short(tab: Tab) -> &'static str {
    match tab {
        Tab::Overview => "Overview",
        Tab::Network => "Network",
        Tab::Nodes => "Nodes",
        Tab::Earnings => "Earnings",
        Tab::Logs => "Logs",
    }
}

fn merge_local(existing: &mut OperatorSnapshot, local: &OperatorSnapshot) {
    existing.status.config_path = local.status.config_path.clone();
    existing.status.process = local.status.process.clone();
    existing.status.metrics = local.status.metrics.clone();
    existing.config = local.config.clone();
    existing.runtime = local.runtime.clone();
    existing.log_tail = local.log_tail.clone();
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AlertLevel {
    Error,
    Warn,
}

struct Alert {
    level: AlertLevel,
    text: String,
}

fn collect_alerts(
    snap: Option<&OperatorSnapshot>,
    local_err: Option<&str>,
    remote_err: Option<&str>,
    doctor: Option<&DoctorReport>,
    doctor_err: Option<&str>,
) -> Vec<Alert> {
    let mut alerts = Vec::new();

    if let Some(e) = local_err {
        alerts.push(Alert {
            level: AlertLevel::Error,
            text: format!("Local sync failed: {e}"),
        });
    }
    if let Some(e) = remote_err {
        alerts.push(Alert {
            level: AlertLevel::Error,
            text: format!("Remote sync failed: {e}"),
        });
    }
    if let Some(e) = doctor_err {
        alerts.push(Alert {
            level: AlertLevel::Warn,
            text: format!("Doctor check failed: {e}"),
        });
    }

    if let Some(s) = snap {
        if !s.status.process.running {
            if let Some(stale) = crate::process_util::stale_pid_in_file() {
                alerts.push(Alert {
                    level: AlertLevel::Warn,
                    text: format!(
                        "Stale PID file (process {stale} gone) — run `proxyhubb-cli stop` then `start`"
                    ),
                });
            } else {
                alerts.push(Alert {
                    level: AlertLevel::Warn,
                    text: "Daemon not running — run `proxyhubb-cli start` in another terminal"
                        .into(),
                });
            }
        } else if let Some(rt) = &s.runtime {
            if !rt.tunnel_connected {
                alerts.push(Alert {
                    level: AlertLevel::Error,
                    text: "Tunnel down — check gateway transport and signing key".into(),
                });
            }
            if let Some(e) = &rt.last_session_error {
                alerts.push(Alert {
                    level: AlertLevel::Warn,
                    text: format!("Session: {}", truncate(e, 56)),
                });
            }
        }

        if s.status.process.running && s.status.metrics.is_none() {
            alerts.push(Alert {
                level: AlertLevel::Warn,
                text:
                    "Local /stats unreachable — metrics port may be wrong or daemon still starting"
                        .into(),
            });
        } else if let Some(m) = &s.status.metrics {
            if m.last_heartbeat_ago_ms > HEARTBEAT_STALE_MS {
                alerts.push(Alert {
                    level: AlertLevel::Warn,
                    text: format!("Heartbeat stale ({}s ago)", m.last_heartbeat_ago_ms / 1000),
                });
            }
        }

        if !s.config.signing_configured {
            alerts.push(Alert {
                level: AlertLevel::Warn,
                text: "provider_signing_key missing — heartbeats may fail in enforce mode".into(),
            });
        }

        if !s.status.control_api.reachable {
            if let Some(e) = &s.status.control_api.error {
                alerts.push(Alert {
                    level: AlertLevel::Warn,
                    text: format!("Control API: {}", truncate(e, 48)),
                });
            }
        }
    }

    if let Some(doc) = doctor {
        if !doc.ok {
            for c in doc.checks.iter().filter(|c| !c.ok && c.severity == "error") {
                alerts.push(Alert {
                    level: AlertLevel::Error,
                    text: format!("{} — {}", c.id, truncate(&c.message, 44)),
                });
            }
        }
    }

    alerts.truncate(3);
    alerts
}

fn render_alert_strip(frame: &mut ratatui::Frame<'_>, area: Rect, alerts: &[Alert], tick: u64) {
    let pulse = if tick % 16 < 8 { "▶" } else { " " };
    let line = if alerts.len() == 1 {
        let a = &alerts[0];
        Line::from(vec![
            Span::styled(format!(" {pulse} ALERT "), alert_style(a.level)),
            Span::styled(truncate(&a.text, 72), theme::value()),
        ])
    } else {
        let parts: Vec<Span> = alerts
            .iter()
            .flat_map(|a| {
                [
                    Span::styled(format!(" {} ", alert_mark(a.level)), alert_style(a.level)),
                    Span::styled(truncate(&a.text, 28), theme::value()),
                    Span::raw(" │ "),
                ]
            })
            .collect();
        let mut spans = vec![Span::styled(format!(" {pulse} "), theme::warn())];
        spans.extend(parts);
        if spans.last().map(|s| s.content.as_ref()) == Some(" │ ") {
            spans.pop();
        }
        Line::from(spans)
    };

    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(theme::SURFACE)),
        area,
    );
}

fn alert_mark(level: AlertLevel) -> &'static str {
    match level {
        AlertLevel::Error => "!!",
        AlertLevel::Warn => "!",
    }
}

fn alert_style(level: AlertLevel) -> Style {
    match level {
        AlertLevel::Error => theme::alert(),
        AlertLevel::Warn => theme::warn(),
    }
}

fn render_banner(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
    err: Option<&str>,
    tick: u64,
) {
    let (status_label, _) = if err.is_some() {
        ("COLLECT ERROR", theme::ALERT)
    } else {
        tunnel_status_style(snap)
    };

    let pulse = if tick % 20 < 10 { "◉" } else { "◎" };
    let lines = vec![
        Line::from(vec![
            Span::styled("▛▀▀ ", theme::label()),
            Span::styled("PROXYHUB", theme::value().add_modifier(Modifier::BOLD)),
            Span::styled(" ▀▀▜  ", theme::label()),
            Span::styled("RETRO OPERATOR v1", theme::dim()),
        ]),
        Line::from(vec![
            Span::styled(format!(" {pulse} "), theme::value()),
            Span::styled("PROVIDER NODE", theme::label()),
            Span::raw("  │  "),
            Span::styled(format!(" {status_label} "), status_badge(status_label)),
            Span::raw("  │  "),
            Span::styled(chrono_hint(snap), theme::dim()),
        ]),
    ];

    let block = retro_block("TERMINAL", true);
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn chrono_hint(snap: Option<&OperatorSnapshot>) -> String {
    if let Some(s) = snap {
        if let Some(m) = &s.status.metrics {
            return format!("uptime {:>5}s", m.uptime_seconds);
        }
    }
    "awaiting telemetry".to_string()
}

fn render_tab_bar(frame: &mut ratatui::Frame<'_>, area: Rect, app: &DashboardApp) {
    let mut spans = Vec::new();
    for t in Tab::ALL {
        let active = t == app.tab;
        let blink = active && app.tick % 16 < 8;
        let prefix = if active {
            if blink {
                "▶"
            } else {
                "▷"
            }
        } else {
            " "
        };
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format!("{prefix}{} ", t.label()),
            if active {
                theme::label()
            } else {
                theme::muted()
            },
        ));
    }
    spans.push(Span::styled("  │  ? help", theme::dim()));

    frame.render_widget(
        Paragraph::new(Line::from(spans)).style(Style::default().bg(theme::SURFACE)),
        area,
    );
}

fn render_body(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    app: &DashboardApp,
    snap: Option<&OperatorSnapshot>,
    err: Option<&str>,
    doctor: Option<&DoctorReport>,
    doctor_err: Option<&str>,
) {
    match app.tab {
        Tab::Overview => render_overview(frame, area, app, snap, err, doctor, doctor_err),
        Tab::Network => render_network(frame, area, app, snap, err),
        Tab::Nodes => render_nodes(frame, area, app, snap),
        Tab::Earnings => render_earnings(frame, area, app, snap),
        Tab::Logs => render_logs(frame, area, app, snap),
    }
}

fn render_overview(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    app: &DashboardApp,
    snap: Option<&OperatorSnapshot>,
    err: Option<&str>,
    doctor: Option<&DoctorReport>,
    doctor_err: Option<&str>,
) {
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
        .split(area);

    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(7), Constraint::Min(5)])
        .split(cols[0]);

    render_status_card(frame, left_chunks[0], snap, err, true);
    render_doctor_panel(frame, left_chunks[1], doctor, doctor_err, true);

    let right_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(8),
            Constraint::Min(3),
            Constraint::Min(3),
        ])
        .split(cols[1]);

    render_tunnel_card(frame, right_chunks[0], snap, true);
    render_spark_card(frame, right_chunks[1], app, "UPLINK", &app.spark_up);
    render_spark_card(frame, right_chunks[2], app, "DOWNLINK", &app.spark_down);
}

fn render_network(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    app: &DashboardApp,
    snap: Option<&OperatorSnapshot>,
    err: Option<&str>,
) {
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(9),
            Constraint::Min(6),
            Constraint::Length(5),
        ])
        .split(area);

    let top = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(rows[0]);

    render_status_card(frame, top[0], snap, err, true);
    render_tunnel_card(frame, top[1], snap, true);
    render_metrics_gauges(frame, rows[1], snap);
    render_spark_card(frame, rows[2], app, "TRAFFIC MIX", &combined_spark(app));
}

fn combined_spark(app: &DashboardApp) -> Vec<u64> {
    app.spark_up
        .iter()
        .zip(app.spark_down.iter())
        .map(|(u, d)| u.saturating_add(*d))
        .collect()
}

fn render_status_card(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
    err: Option<&str>,
    focused: bool,
) {
    let lines = if let Some(err) = err {
        vec![Line::from(Span::styled(
            format!("ERR │ {err}"),
            theme::alert(),
        ))]
    } else if let Some(s) = snap {
        let p = &s.status.process;
        vec![
            line_kv("CONFIG", truncate_path(&s.status.config_path, 28)),
            line_kv(
                "PROC",
                if p.running {
                    format!("RUN pid {:?}", p.pid.unwrap_or(0))
                } else {
                    "STOP".to_string()
                },
            ),
            line_kv("API", &s.status.control_api.url),
            line_kv(
                "USER",
                s.status.control_api.user_id.as_deref().unwrap_or("—"),
            ),
        ]
    } else {
        vec![Line::from(Span::styled("SYNC │ …", theme::dim()))]
    };

    frame.render_widget(
        Paragraph::new(lines).block(retro_block("SYSTEM", focused)),
        area,
    );
}

fn render_tunnel_card(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
    focused: bool,
) {
    let lines = if let Some(s) = snap {
        let mut lines = vec![
            line_kv("MODE", &s.config.transport),
            line_kv(
                "SIGN",
                if s.config.signing_configured {
                    "OK"
                } else {
                    "MISSING"
                },
            ),
            line_kv("PORT", format!(":{}", s.config.metrics_port)),
        ];
        if let Some(rt) = &s.runtime {
            lines.push(line_kv(
                "GWAY",
                format!(
                    "{} ({}/{})",
                    rt.active_gateway,
                    rt.gateway_index + 1,
                    rt.gateway_total
                ),
            ));
            lines.push(line_kv(
                "LINK",
                if rt.tunnel_connected { "UP" } else { "DOWN" },
            ));
            if let Some(e) = &rt.last_session_error {
                lines.push(Line::from(Span::styled(
                    format!("ERR │ {e}"),
                    theme::warn(),
                )));
            }
        }
        lines
    } else {
        vec![Line::from(Span::styled("SYNC │ …", theme::dim()))]
    };

    frame.render_widget(
        Paragraph::new(lines).block(retro_block("TUNNEL", focused)),
        area,
    );
}

fn render_metrics_gauges(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
) {
    let block = retro_block("TELEMETRY", true);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    if let Some(s) = snap {
        if let Some(m) = &s.status.metrics {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(2),
                    Constraint::Length(2),
                    Constraint::Length(2),
                    Constraint::Min(1),
                ])
                .split(inner);

            let hb_pct = (100u16
                .saturating_sub((m.last_heartbeat_ago_ms / 1000).min(120) as u16 * 100 / 120))
            .max(5);
            frame.render_widget(
                Gauge::default()
                    .gauge_style(Style::default().fg(theme::PHOSPHOR).bg(theme::MUTED))
                    .percent(hb_pct)
                    .label(format!(
                        "HEARTBEAT {:>3}% · {}ms ago",
                        hb_pct, m.last_heartbeat_ago_ms
                    )),
                chunks[0],
            );

            let load_pct = m.active_connections.clamp(0, 100) as u16;
            frame.render_widget(
                Gauge::default()
                    .gauge_style(Style::default().fg(theme::AMBER).bg(theme::MUTED))
                    .percent(load_pct)
                    .label(format!("SESSIONS {:>3}", m.active_connections)),
                chunks[1],
            );

            let bw = (m.rate_up_kbps.saturating_add(m.rate_down_kbps) / 10).min(100) as u16;
            frame.render_widget(
                Gauge::default()
                    .gauge_style(Style::default().fg(theme::WARN).bg(theme::MUTED))
                    .percent(bw.max(3))
                    .label(format!(
                        "BW ↑{} ↓{} kbps · lat {}ms",
                        m.rate_up_kbps, m.rate_down_kbps, m.latency_ms
                    )),
                chunks[2],
            );

            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    format!(
                        "TYPE {} · TOTAL CONN {}",
                        m.connection_type, m.total_connections
                    ),
                    theme::dim(),
                ))),
                chunks[3],
            );
            return;
        }
    }

    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "NO /stats — start daemon in other terminal",
            theme::warn(),
        ))),
        inner,
    );
}

fn render_spark_card(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    _app: &DashboardApp,
    title: &str,
    data: &[u64],
) {
    let block = retro_block(title, false);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    if data.is_empty() {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "waiting for samples…",
                theme::muted(),
            )))
            .alignment(Alignment::Center),
            inner,
        );
        return;
    }

    let max = data.iter().copied().max().unwrap_or(1).max(1);
    let spark = Sparkline::default()
        .data(data.iter().map(|v| v * 100 / max).collect::<Vec<_>>())
        .style(Style::default().fg(theme::PHOSPHOR));
    frame.render_widget(spark, inner);
}

fn render_earnings(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    _app: &DashboardApp,
    snap: Option<&OperatorSnapshot>,
) {
    let lines = if let Some(s) = snap {
        if let Some(e) = &s.earnings {
            vec![
                Line::from(""),
                line_kv("TOTAL", format!("{:.4} SOL", e.total_earned_sol)),
                line_kv("PEND", format!("{:.4} SOL", e.pending_sol)),
                line_kv("PAID", format!("{:.4} SOL", e.paid_sol)),
                line_kv("7D", format!("{:.4} SOL", e.last_7_days_sol)),
                line_kv("30D", format!("{:.4} SOL", e.last_30_days_sol)),
                line_kv(
                    "SESS",
                    format!("{} · {:.2} GB", e.total_sessions, e.total_bandwidth_gb),
                ),
            ]
        } else {
            vec![
                Line::from(""),
                Line::from(Span::styled("  EARNINGS CHANNEL OFFLINE", theme::warn())),
                Line::from(Span::styled(
                    "  check api_key and control-api",
                    theme::dim(),
                )),
            ]
        }
    } else {
        vec![Line::from(Span::styled("  …", theme::dim()))]
    };

    frame.render_widget(
        Paragraph::new(lines)
            .block(retro_block("REWARDS LEDGER", true))
            .alignment(Alignment::Center),
        area,
    );
}

fn render_nodes(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    app: &DashboardApp,
    snap: Option<&OperatorSnapshot>,
) {
    let api = snap.map(|s| &s.status.control_api);
    let rows: Vec<Row> = if let Some(api) = api {
        if api.nodes.is_empty() {
            vec![Row::new(vec![api
                .error
                .clone()
                .unwrap_or_else(|| "no nodes registered".to_string())])]
        } else {
            api.nodes
                .iter()
                .enumerate()
                .map(|(i, n)| {
                    let proof = if n.latest_heartbeat_verified {
                        "PROOF OK".to_string()
                    } else if !n.latest_heartbeat_verification_error.is_empty() {
                        truncate(&n.latest_heartbeat_verification_error, 24)
                    } else {
                        "—".to_string()
                    };
                    let style = if i == app.node_cursor {
                        Style::default()
                            .fg(theme::BG)
                            .bg(theme::AMBER)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        theme::value()
                    };
                    Row::new(vec![truncate(&n.name, 14), n.status.clone(), proof]).style(style)
                })
                .collect()
        }
    } else {
        vec![Row::new(vec!["…".to_string()])]
    };

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(38),
            Constraint::Length(12),
            Constraint::Percentage(50),
        ],
    )
    .header(
        Row::new(vec!["NODE", "STATE", "HEARTBEAT"])
            .style(theme::label())
            .bottom_margin(1),
    )
    .block(retro_block("NODE REGISTRY  j/k select", true));

    frame.render_widget(table, area);
}

fn render_logs(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    app: &DashboardApp,
    snap: Option<&OperatorSnapshot>,
) {
    let all_lines: Vec<Line> = snap
        .map(|s| {
            if s.log_tail.is_empty() {
                vec![Line::from(Span::styled(
                    " log empty — run `proxyhubb-cli start` in another terminal ",
                    theme::muted(),
                ))]
            } else {
                s.log_tail
                    .iter()
                    .map(|l| {
                        Line::from(Span::styled(
                            format!("› {l}"),
                            if l.contains("error") || l.contains("lost") {
                                theme::warn()
                            } else {
                                theme::dim()
                            },
                        ))
                    })
                    .collect()
            }
        })
        .unwrap_or_else(|| vec![Line::from("…")]);

    let max_scroll = all_lines.len().saturating_sub(LOG_PAGE);
    let scroll = app.log_scroll.min(max_scroll);
    let window: Vec<Line> = all_lines.into_iter().skip(scroll).take(LOG_PAGE).collect();

    let title = format!("LOG STREAM  {}/{}  j/k scroll", scroll + 1, max_scroll + 1);
    frame.render_widget(
        Paragraph::new(window)
            .wrap(Wrap { trim: true })
            .block(retro_block(&title, true)),
        area,
    );
}

fn render_doctor_panel(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    doctor: Option<&DoctorReport>,
    doctor_err: Option<&str>,
    focused: bool,
) {
    let title = if let Some(d) = doctor {
        if d.ok {
            "DOCTOR  all clear  d refresh"
        } else {
            "DOCTOR  fix FAIL items  d refresh"
        }
    } else {
        "DOCTOR  d refresh"
    };

    let lines = if let Some(err) = doctor_err {
        vec![Line::from(Span::styled(
            format!("ERR │ {err}"),
            theme::alert(),
        ))]
    } else if let Some(report) = doctor {
        doctor_check_lines(report)
    } else {
        vec![Line::from(Span::styled("RUN │ checking…", theme::dim()))]
    };

    frame.render_widget(
        Paragraph::new(lines).block(retro_block(title, focused)),
        area,
    );
}

fn doctor_check_lines(report: &DoctorReport) -> Vec<Line<'static>> {
    let mut checks: Vec<&Check> = report.checks.iter().collect();
    checks.sort_by(|a, b| {
        let rank = |c: &&Check| {
            if !c.ok && c.severity == "error" {
                0
            } else if !c.ok {
                1
            } else {
                2
            }
        };
        rank(a).cmp(&rank(b)).then_with(|| a.id.cmp(&b.id))
    });

    checks
        .into_iter()
        .take(7)
        .map(|c| {
            let (mark, style) = if c.ok {
                ("OK  ", theme::value())
            } else if c.severity == "warn" {
                ("WARN", theme::warn())
            } else {
                ("FAIL", theme::alert())
            };
            Line::from(vec![
                Span::styled(format!("{mark} "), style),
                Span::styled(truncate(&c.id, 14), theme::label()),
                Span::raw(" "),
                Span::styled(truncate(&c.message, 34), theme::dim()),
            ])
        })
        .collect()
}

fn render_command_bar(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    refresh_ms: u64,
    app: &DashboardApp,
    sync_hint: &str,
) {
    let mut spans = vec![
        Span::styled(" CMD ", theme::label()),
        Span::styled(
            "1-5 tabs │ j/k scroll │ r sync all │ d doctor │ ? help │ q quit ",
            theme::dim(),
        ),
        Span::styled(
            format!(
                "│ local {refresh_ms}ms · remote {REMOTE_REFRESH_MS}ms · doctor {DOCTOR_REFRESH_MS}ms",
            ),
            theme::muted(),
        ),
    ];
    if !sync_hint.is_empty() {
        spans.push(Span::styled(sync_hint.to_string(), theme::warn()));
    }
    if let Some(hint) = active_hint(app) {
        spans.push(Span::raw(" │ "));
        spans.push(Span::styled(hint.to_string(), theme::dim()));
    }
    spans.push(Span::raw(" "));
    spans.push(Span::styled(
        if app.tick % 24 < 12 { "▮" } else { "▯" },
        theme::value(),
    ));
    let line = Line::from(spans);
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(theme::SURFACE)),
        area,
    );
}

fn render_help_overlay(frame: &mut ratatui::Frame<'_>, area: Rect) {
    let popup = centered_rect(60, 70, area);
    frame.render_widget(
        Paragraph::new("").style(Style::default().bg(theme::BG)),
        area,
    );

    let text = vec![
        Line::from(Span::styled(" PROXYHUB RETRO DASHBOARD ", theme::label())),
        Line::from(""),
        Line::from(Span::styled(" Navigation ", theme::value())),
        Line::from(Span::styled("  1-5      switch panels", theme::dim())),
        Line::from(Span::styled("  Tab      next panel", theme::dim())),
        Line::from(Span::styled("  j/k      scroll logs / nodes", theme::dim())),
        Line::from(Span::styled(
            "  r        force local + remote sync",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  d        re-run doctor checks",
            theme::dim(),
        )),
        Line::from(Span::styled("  q        quit", theme::dim())),
        Line::from(""),
        Line::from(Span::styled(" Setup ", theme::value())),
        Line::from(Span::styled(
            "  Terminal 1: proxyhubb-cli start",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  Terminal 2: proxyhubb-cli dashboard",
            theme::dim(),
        )),
        Line::from(""),
        Line::from(Span::styled(" press ? or Esc to close ", theme::muted())),
    ];

    frame.render_widget(
        Paragraph::new(text)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Double)
                    .border_style(theme::label())
                    .title(" HELP ")
                    .style(Style::default().bg(theme::SURFACE)),
            )
            .alignment(Alignment::Center),
        popup,
    );
}

fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

fn line_kv(key: &str, val: impl AsRef<str>) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{key:<6} "), theme::label()),
        Span::styled(val.as_ref().to_string(), theme::value()),
    ])
}

fn tunnel_status_style(snap: Option<&OperatorSnapshot>) -> (&'static str, ratatui::style::Color) {
    let Some(s) = snap else {
        return ("LOADING", theme::DIM);
    };
    if !s.status.process.running {
        return ("OFFLINE", theme::ALERT);
    }
    if let Some(rt) = &s.runtime {
        if rt.tunnel_connected {
            return ("TUNNEL UP", theme::PHOSPHOR);
        }
        if rt.last_session_error.is_some() {
            return ("RECONNECTING", theme::WARN);
        }
    }
    if let Some(m) = &s.status.metrics {
        if m.last_heartbeat_ago_ms < 90_000 {
            return ("TUNNEL UP", theme::PHOSPHOR);
        }
    }
    ("STARTING", theme::WARN)
}

fn truncate_path(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!(
            "…{}",
            s.chars()
                .rev()
                .take(max.saturating_sub(1))
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
        )
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!(
            "{}…",
            s.chars().take(max.saturating_sub(1)).collect::<String>()
        )
    }
}
