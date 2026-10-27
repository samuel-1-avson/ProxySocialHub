use crate::doctor::{Check, DoctorReport};
use crate::operator::OperatorSnapshot;
use crate::tui::theme::{self, panel_block, retro_block, status_badge};
use anyhow::Result;
use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind, KeyModifiers,
    MouseButton, MouseEventKind,
};
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
            Tab::Overview => "Overview",
            Tab::Network => "Network",
            Tab::Nodes => "Nodes",
            Tab::Earnings => "Earnings",
            Tab::Logs => "Logs",
        }
    }

    fn key(self) -> char {
        match self {
            Tab::Overview => '1',
            Tab::Network => '2',
            Tab::Nodes => '3',
            Tab::Earnings => '4',
            Tab::Logs => '5',
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
    node_detail: bool,
    log_errors_only: bool,
    log_wrap: bool,
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
            node_detail: false,
            log_errors_only: false,
            log_wrap: true,
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
    stdout.execute(EnableMouseCapture)?;
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
                Event::Mouse(mouse) => handle_mouse_event(&mut app, &data, mouse)?,
                Event::Resize(_, _) => LoopAction::Continue,
                _ => LoopAction::Continue,
            };
            draw_dashboard(&mut terminal, refresh_ms, &app, &data, &in_flight)?;
            if action == LoopAction::Quit {
                disable_raw_mode()?;
                stdout.execute(DisableMouseCapture)?;
                stdout.execute(LeaveAlternateScreen)?;
                ratatui::restore();
                return Ok(());
            }
        }
    }
}

fn handle_mouse_event(
    app: &mut DashboardApp,
    data: &DashboardData,
    mouse: event::MouseEvent,
) -> Result<LoopAction> {
    // Tab bar is the 3rd row from top (banner 5 + alerts 0-2 + tab 3). Approximate by y.
    if mouse.kind == MouseEventKind::Down(MouseButton::Left) {
        let y = mouse.row;
        // rough tab bar hit: rows 5-7 (after banner)
        if (5..=7).contains(&y) {
            let x = mouse.column;
            // each tab label ~14 chars wide
            let idx = (x / 14).min(Tab::ALL.len().saturating_sub(1) as u16) as usize;
            if idx < Tab::ALL.len() {
                app.tab = Tab::ALL[idx];
                app.node_detail = false;
                set_hint(app, format!("Tab → {}", app.tab.label().trim()));
            }
        }
        // node row click: approximate body start
        if app.tab == Tab::Nodes && y >= 10 {
            let row = (y - 10) as usize;
            if row
                < data
                    .snapshot
                    .as_ref()
                    .map(|s| s.status.control_api.nodes.len())
                    .unwrap_or(0)
            {
                app.node_cursor = row;
                set_hint(app, "Node selected — Enter for detail");
            }
        }
    }
    if app.tab == Tab::Logs {
        match mouse.kind {
            MouseEventKind::ScrollDown => {
                app.log_scroll = app.log_scroll.saturating_add(1);
                set_hint(app, "Logs ↓");
            }
            MouseEventKind::ScrollUp => {
                app.log_scroll = app.log_scroll.saturating_sub(1);
                set_hint(app, "Logs ↑");
            }
            _ => {}
        }
    }
    Ok(LoopAction::Continue)
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
        // Build constraints without a zero-height slot — a Length(0) still
        // occupies an index and used to shift tab/body/cmd when no alerts.
        let mut constraints = vec![Constraint::Length(5)];
        if alert_h > 0 {
            constraints.push(Constraint::Length(alert_h));
        }
        constraints.extend([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(3),
        ]);
        let layout = Layout::default()
            .direction(Direction::Vertical)
            .constraints(constraints)
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
                        match &mut data.snapshot {
                            Some(existing) => merge_remote(existing, snap),
                            None => data.snapshot = Some(snap),
                        }
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

    if !in_flight.remote && (force || now.duration_since(*last_remote) >= remote_refresh) {
        in_flight.remote = true;
        *last_remote = now;
        let path = config_path.to_path_buf();
        let tx = tx.clone();
        let snap_opt = snapshot.clone();
        tokio::spawn(async move {
            let msg = if let Some(mut snap) = snap_opt {
                match crate::operator::refresh_remote(&mut snap, path).await {
                    Ok(()) => RefreshMsg::Remote(Ok(snap)),
                    Err(e) => RefreshMsg::Remote(Err(e.to_string())),
                }
            } else {
                match crate::operator::collect(path).await {
                    Ok(s) => RefreshMsg::Remote(Ok(s)),
                    Err(e) => RefreshMsg::Remote(Err(e.to_string())),
                }
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
        KeyCode::Char('q') | KeyCode::Esc => {
            if app.node_detail {
                app.node_detail = false;
                set_hint(app, "Node list");
                return Ok(LoopAction::Continue);
            }
            return Ok(LoopAction::Quit);
        }
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
        KeyCode::Enter => {
            if app.tab == Tab::Nodes {
                app.node_detail = !app.node_detail;
                set_hint(
                    app,
                    if app.node_detail {
                        "Node detail"
                    } else {
                        "Node list"
                    },
                );
            }
        }
        KeyCode::Char('e') | KeyCode::Char('a') => {
            if app.tab == Tab::Logs {
                app.log_errors_only = !app.log_errors_only;
                app.log_scroll = 0;
                set_hint(
                    app,
                    if app.log_errors_only {
                        "Logs: errors only"
                    } else {
                        "Logs: all"
                    },
                );
            }
        }
        KeyCode::Char('w') => {
            if app.tab == Tab::Logs {
                app.log_wrap = !app.log_wrap;
                set_hint(app, if app.log_wrap { "Wrap on" } else { "Wrap off" });
            }
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

fn merge_remote(existing: &mut OperatorSnapshot, remote: OperatorSnapshot) {
    existing.status.control_api = remote.status.control_api;
    existing.earnings = remote.earnings;
    existing.health = remote.health;
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
            if let Some(e) = &rt.last_session_error {
                if is_auth_session_error(e) {
                    alerts.push(Alert {
                        level: AlertLevel::Error,
                        text: format!("AUTH FAIL: {}", truncate(e, 96)),
                    });
                } else if !rt.tunnel_connected {
                    alerts.push(Alert {
                        level: AlertLevel::Error,
                        text: "Tunnel down — check gateway transport and signing key".into(),
                    });
                    alerts.push(Alert {
                        level: AlertLevel::Warn,
                        text: format!("Session: {}", truncate(e, 56)),
                    });
                } else {
                    alerts.push(Alert {
                        level: AlertLevel::Warn,
                        text: format!("Session: {}", truncate(e, 56)),
                    });
                }
            } else if !rt.tunnel_connected {
                alerts.push(Alert {
                    level: AlertLevel::Error,
                    text: "Tunnel down — check gateway transport and signing key".into(),
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

    let nodes_n = snap.map(|s| s.status.control_api.nodes.len()).unwrap_or(0);
    let pulse = if tick % 20 < 10 { "●" } else { "○" };
    let lines = vec![
        Line::from(vec![
            Span::styled(" PROXYHUB ", theme::value().add_modifier(Modifier::BOLD)),
            Span::styled(format!("v{} ", env!("CARGO_PKG_VERSION")), theme::dim()),
            Span::styled("· operator ", theme::muted()),
        ]),
        Line::from(vec![
            Span::styled(format!(" {pulse} "), theme::value()),
            Span::styled(format!(" {status_label} "), status_badge(status_label)),
            Span::raw("  "),
            Span::styled(chrono_hint(snap), theme::dim()),
            Span::raw("  ·  "),
            Span::styled(
                if nodes_n == 0 {
                    "nodes —".to_string()
                } else {
                    format!("{nodes_n} node{}", if nodes_n == 1 { "" } else { "s" })
                },
                theme::label(),
            ),
        ]),
    ];

    frame.render_widget(
        Paragraph::new(lines).block(retro_block("TERMINAL", true)),
        area,
    );
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
        let label = format!(" {} {} ", t.key(), t.label());
        if active {
            spans.push(Span::styled(
                label,
                Style::default()
                    .fg(theme::BG)
                    .bg(theme::AMBER)
                    .add_modifier(Modifier::BOLD),
            ));
        } else {
            spans.push(Span::styled(label, theme::dim()));
        }
        spans.push(Span::raw(" "));
    }
    spans.push(Span::styled("? help", theme::muted()));

    frame.render_widget(
        Paragraph::new(Line::from(spans)).block(
            Block::default()
                .borders(Borders::BOTTOM)
                .border_style(theme::panel_border(false))
                .style(Style::default().bg(theme::SURFACE)),
        ),
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
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(5),
            Constraint::Min(6),
            Constraint::Length(3),
        ])
        .split(area);

    render_health_banner(frame, rows[0], snap, err);
    render_kpi_row(frame, rows[1], snap);

    let mid = if area.width < 90 {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
            .split(rows[2])
    } else {
        Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
            .split(rows[2])
    };
    render_spark_card(frame, mid[0], app, "TRAFFIC", &combined_spark(app));
    render_doctor_summary(frame, mid[1], doctor, doctor_err);

    render_overview_footer(frame, rows[3], snap);
}

fn render_health_banner(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
    err: Option<&str>,
) {
    let (label, style, detail) = if let Some(e) = err {
        ("COLLECT ERROR", theme::alert(), truncate(e, 60))
    } else if let Some(s) = snap {
        if let Some(h) = &s.health {
            let st = match h.state.as_str() {
                "ONLINE" => theme::ok_badge(),
                "DEGRADED" => theme::warn_badge(),
                _ => theme::alert_badge(),
            };
            let detail = if h.reasons.is_empty() {
                format!("score {} · all systems nominal", h.score)
            } else {
                format!("score {} · {}", h.score, h.reasons.join(" · "))
            };
            (h.state.as_str(), st, detail)
        } else {
            let (l, _) = tunnel_status_style(Some(s));
            (l, theme::warn_badge(), "health computing…".to_string())
        }
    } else {
        ("LOADING", theme::muted(), "…".to_string())
    };

    let lines = vec![Line::from(vec![
        Span::styled(" HEALTH ", theme::label()),
        Span::styled(format!(" {label} "), style),
        Span::styled(format!(" {detail}"), theme::dim()),
    ])];
    frame.render_widget(
        Paragraph::new(lines).block(panel_block("STATUS", true)),
        area,
    );
}

fn render_kpi_row(frame: &mut ratatui::Frame<'_>, area: Rect, snap: Option<&OperatorSnapshot>) {
    let block = panel_block("KEY METRICS", true);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let Some(s) = snap else {
        frame.render_widget(Paragraph::new(" …").style(theme::dim()), inner);
        return;
    };

    let (sessions, up, down, lat, hb, today) = if let Some(m) = &s.status.metrics {
        (
            format!("{}/{}", m.active_connections, m.total_connections),
            format!("{} kbps", m.rate_up_kbps),
            format!("{} kbps", m.rate_down_kbps),
            format!("{} ms", m.latency_ms),
            format!("{} s", m.last_heartbeat_ago_ms / 1000),
            s.earnings
                .as_ref()
                .map(|e| format!("{:.3} SOL", e.last_7_days_sol / 7.0))
                .unwrap_or_else(|| "—".into()),
        )
    } else {
        (
            "—".into(),
            "—".into(),
            "—".into(),
            "—".into(),
            "—".into(),
            s.earnings
                .as_ref()
                .map(|e| format!("{:.3} SOL", e.last_7_days_sol / 7.0))
                .unwrap_or_else(|| "—".into()),
        )
    };

    let cells = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(16),
            Constraint::Percentage(18),
            Constraint::Percentage(18),
            Constraint::Percentage(14),
            Constraint::Percentage(16),
            Constraint::Percentage(18),
        ])
        .split(inner);

    let items = [
        ("ACTIVE", sessions),
        ("UPLINK", up),
        ("DOWNLINK", down),
        ("LATENCY", lat),
        ("HEARTBEAT", hb),
        ("EARN/24h", today),
    ];
    for (i, (k, v)) in items.iter().enumerate() {
        let line = vec![
            Line::from(Span::styled(*k, theme::muted())),
            Line::from(Span::styled(
                v.clone(),
                theme::value().add_modifier(Modifier::BOLD),
            )),
        ];
        frame.render_widget(Paragraph::new(line).alignment(Alignment::Center), cells[i]);
    }
}

fn render_doctor_summary(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    doctor: Option<&DoctorReport>,
    doctor_err: Option<&str>,
) {
    let (title, lines) = if let Some(e) = doctor_err {
        (
            "DOCTOR  error",
            vec![Line::from(Span::styled(
                format!("ERR │ {e}"),
                theme::alert(),
            ))],
        )
    } else if let Some(d) = doctor {
        let failing: Vec<&Check> = d.checks.iter().filter(|c| !c.ok).collect();
        if failing.is_empty() {
            (
                "DOCTOR  all clear",
                vec![Line::from(Span::styled("No blocking issues", theme::ok()))],
            )
        } else {
            let mut lines = Vec::new();
            for c in failing.iter().take(4) {
                let style = if c.severity == "error" {
                    theme::alert()
                } else {
                    theme::warn()
                };
                lines.push(Line::from(Span::styled(
                    format!("{} │ {}", c.id, truncate(&c.message, 40)),
                    style,
                )));
            }
            if failing.len() > 4 {
                lines.push(Line::from(Span::styled(
                    format!("… +{} more (press d)", failing.len() - 4),
                    theme::dim(),
                )));
            }
            ("DOCTOR  action needed", lines)
        }
    } else {
        (
            "DOCTOR  …",
            vec![Line::from(Span::styled("checking…", theme::dim()))],
        )
    };

    frame.render_widget(Paragraph::new(lines).block(retro_block(title, true)), area);
}

fn render_overview_footer(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
) {
    let text = if let Some(s) = snap {
        let rt = s.runtime.as_ref();
        let gw = rt.map(|r| r.active_gateway.as_str()).unwrap_or("—");
        let link = rt
            .map(|r| if r.tunnel_connected { "UP" } else { "DOWN" })
            .unwrap_or("—");
        format!(
            "Gateway {} · link {} · transport {} · sign {}",
            gw,
            link,
            s.config.transport,
            if s.config.signing_configured {
                "OK"
            } else {
                "MISSING"
            }
        )
    } else {
        "…".to_string()
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(text, theme::dim())))
            .block(retro_block("CONNECTION", true)),
        area,
    );
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
            Constraint::Length(6),
            Constraint::Min(7),
            Constraint::Length(5),
        ])
        .split(area);

    render_gateway_info(frame, rows[0], snap, err);

    let mid = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(rows[1]);
    render_throughput_graph(frame, mid[0], app);
    render_latency_panel(frame, mid[1], snap);

    render_network_footer(frame, rows[2], snap);
}

fn render_gateway_info(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
    err: Option<&str>,
) {
    let lines =
        if let Some(e) = err {
            vec![Line::from(Span::styled(
                format!("ERR │ {e}"),
                theme::alert(),
            ))]
        } else if let Some(s) = snap {
            let rt = s.runtime.as_ref();
            vec![
                line_kv(
                    "GATEWAY",
                    rt.map(|r| {
                        format!(
                            "{} ({}/{})",
                            r.active_gateway,
                            r.gateway_index + 1,
                            r.gateway_total
                        )
                    })
                    .unwrap_or_else(|| s.config.gateways.join(", ")),
                ),
                line_kv(
                    "LINK",
                    rt.map(|r| if r.tunnel_connected { "UP" } else { "DOWN" })
                        .unwrap_or("—"),
                ),
                line_kv(
                    "TLS",
                    if s.config.gateways.iter().any(|g| {
                        g.contains("proxyhubb.com") || g.parse::<std::net::Ipv4Addr>().is_ok()
                    }) {
                        "ON"
                    } else {
                        "—"
                    },
                ),
                line_kv("TRANSPORT", &s.config.transport),
            ]
        } else {
            vec![Line::from(Span::styled("SYNC │ …", theme::dim()))]
        };
    frame.render_widget(
        Paragraph::new(lines).block(retro_block("GATEWAY", true)),
        area,
    );
}

fn render_throughput_graph(frame: &mut ratatui::Frame<'_>, area: Rect, app: &DashboardApp) {
    let up = &app.spark_up;
    let down = &app.spark_down;
    let max = up
        .iter()
        .chain(down.iter())
        .max()
        .copied()
        .unwrap_or(1)
        .max(1);

    let up_data: Vec<u64> = up.iter().map(|v| v.saturating_mul(100) / max).collect();
    let down_data: Vec<u64> = down.iter().map(|v| v.saturating_mul(100) / max).collect();

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    frame.render_widget(
        Sparkline::default()
            .block(retro_block("UPLINK kbps", true))
            .data(&up_data)
            .style(Style::default().fg(theme::AMBER)),
        chunks[0],
    );
    frame.render_widget(
        Sparkline::default()
            .block(retro_block("DOWNLINK kbps", true))
            .data(&down_data)
            .style(Style::default().fg(theme::PHOSPHOR)),
        chunks[1],
    );
}

fn render_latency_panel(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
) {
    let block = retro_block("LATENCY / SESSIONS", true);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let Some(s) = snap else {
        frame.render_widget(Paragraph::new(" …").style(theme::dim()), inner);
        return;
    };
    let Some(m) = &s.status.metrics else {
        frame.render_widget(
            Paragraph::new("NO /stats — start daemon").style(theme::warn()),
            inner,
        );
        return;
    };

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2),
            Constraint::Length(2),
            Constraint::Length(2),
            Constraint::Min(1),
        ])
        .split(inner);

    let lat_pct = (m.latency_ms.min(500) as u16 * 100 / 500).max(3);
    frame.render_widget(
        Gauge::default()
            .gauge_style(Style::default().fg(theme::WARN).bg(theme::MUTED))
            .percent(lat_pct)
            .label(format!("CUR {} ms", m.latency_ms)),
        rows[0],
    );
    frame.render_widget(
        Gauge::default()
            .gauge_style(Style::default().fg(theme::AMBER).bg(theme::MUTED))
            .percent((m.latency_avg_ms.min(500) as u16 * 100 / 500).max(3))
            .label(format!(
                "AVG {} ms · MAX {} ms",
                m.latency_avg_ms, m.latency_max_ms
            )),
        rows[1],
    );
    let sess_pct = m.active_connections.clamp(0, 100) as u16;
    frame.render_widget(
        Gauge::default()
            .gauge_style(Style::default().fg(theme::PHOSPHOR).bg(theme::MUTED))
            .percent(sess_pct)
            .label(format!(
                "SESSIONS {} · FAILED {}",
                m.active_connections, m.failed_connections
            )),
        rows[2],
    );
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            format!(
                "TOTAL {} · HB {}s ago",
                m.total_connections,
                m.last_heartbeat_ago_ms / 1000
            ),
            theme::dim(),
        ))),
        rows[3],
    );
}

fn render_network_footer(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    snap: Option<&OperatorSnapshot>,
) {
    let text = if let Some(s) = snap {
        if let Some(m) = &s.status.metrics {
            format!(
                "bytes ↑{} ↓{} · type {} · port :{}",
                format_bytes(m.bytes_up),
                format_bytes(m.bytes_down),
                m.connection_type,
                s.config.metrics_port
            )
        } else {
            "metrics offline".to_string()
        }
    } else {
        "…".to_string()
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(text, theme::dim())))
            .block(retro_block("TOTALS", true)),
        area,
    );
}

fn format_bytes(n: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if n >= GB {
        format!("{:.1} GB", n as f64 / GB as f64)
    } else if n >= MB {
        format!("{:.1} MB", n as f64 / MB as f64)
    } else if n >= KB {
        format!("{:.1} KB", n as f64 / KB as f64)
    } else {
        format!("{n} B")
    }
}

fn combined_spark(app: &DashboardApp) -> Vec<u64> {
    app.spark_up
        .iter()
        .zip(app.spark_down.iter())
        .map(|(u, d)| u.saturating_add(*d))
        .collect()
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
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(8), Constraint::Min(4)])
        .split(area);

    if let Some(s) = snap {
        if let Some(e) = &s.earnings {
            let top = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage(25),
                    Constraint::Percentage(25),
                    Constraint::Percentage(25),
                    Constraint::Percentage(25),
                ])
                .split(rows[0]);

            let cards = [
                ("TOTAL", format!("{:.4}", e.total_earned_sol)),
                ("PENDING", format!("{:.4}", e.pending_sol)),
                ("PAID", format!("{:.4}", e.paid_sol)),
                ("TODAY", format!("{:.4}", e.last_7_days_sol / 7.0)),
            ];
            for (i, (k, v)) in cards.iter().enumerate() {
                let lines = vec![
                    Line::from(Span::styled(*k, theme::muted())),
                    Line::from(Span::styled(
                        format!("{v} SOL"),
                        theme::value().add_modifier(Modifier::BOLD),
                    )),
                ];
                frame.render_widget(
                    Paragraph::new(lines)
                        .block(retro_block("", true))
                        .alignment(Alignment::Center),
                    top[i],
                );
            }

            let bottom_lines = vec![
                line_kv("7 DAYS", format!("{:.4} SOL", e.last_7_days_sol)),
                line_kv("30 DAYS", format!("{:.4} SOL", e.last_30_days_sol)),
                line_kv(
                    "SERVED",
                    format!(
                        "{} sessions · {:.2} GB",
                        e.total_sessions, e.total_bandwidth_gb
                    ),
                ),
                Line::from(Span::styled(
                    "SOL is credited when a buyer session ends and usage is settled. Live CONNECT bytes show on Network.",
                    theme::dim(),
                )),
            ];
            frame.render_widget(
                Paragraph::new(bottom_lines).block(retro_block("DETAILS", true)),
                rows[1],
            );
            return;
        }
    }

    let lines = vec![
        Line::from(""),
        Line::from(Span::styled("  EARNINGS CHANNEL OFFLINE", theme::warn())),
        Line::from(Span::styled(
            "  check api_key and control-api",
            theme::dim(),
        )),
    ];
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
    // Wide terminals: list + detail side-by-side so rows never hide behind a tiny pane.
    let split = area.width >= 88;
    if split {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
            .split(area);
        render_node_table(frame, cols[0], app, api);
        render_node_detail(frame, cols[1], app, api, true);
        return;
    }
    if app.node_detail {
        render_node_detail(frame, area, app, api, false);
    } else {
        render_node_table(frame, area, app, api);
    }
}

fn render_node_table(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    app: &DashboardApp,
    api: Option<&crate::status::ControlAPIStatus>,
) {
    let rows: Vec<Row> = if let Some(api) = api {
        if api.nodes.is_empty() {
            let msg = if let Some(err) = api.error.as_ref().filter(|e| !e.is_empty()) {
                format!("API: {err}")
            } else if !api.reachable {
                "Syncing Control API… press r".to_string()
            } else {
                "No nodes on this account".to_string()
            };
            vec![Row::new(vec![
                truncate(&msg, 40),
                "—".to_string(),
                "—".to_string(),
                "—".to_string(),
            ])
            .style(theme::warn())]
        } else {
            api.nodes
                .iter()
                .enumerate()
                .map(|(i, n)| {
                    let proof = if n.latest_heartbeat_verified {
                        "PROOF OK".to_string()
                    } else if !n.latest_heartbeat_verification_error.is_empty() {
                        "FAIL".to_string()
                    } else {
                        "UNSIGNED".to_string()
                    };
                    let style = if i == app.node_cursor {
                        Style::default()
                            .fg(theme::BG)
                            .bg(theme::AMBER)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        theme::value()
                    };
                    Row::new(vec![
                        truncate(&n.name, 18),
                        n.status.to_ascii_uppercase(),
                        proof,
                        if n.ip_address.is_empty() {
                            "—".to_string()
                        } else {
                            truncate(&n.ip_address, 15)
                        },
                    ])
                    .style(style)
                })
                .collect()
        }
    } else {
        vec![Row::new(vec![
            "Loading…".to_string(),
            "—".to_string(),
            "—".to_string(),
            "—".to_string(),
        ])
        .style(theme::dim())]
    };

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(36),
            Constraint::Length(10),
            Constraint::Length(10),
            Constraint::Percentage(30),
        ],
    )
    .header(
        Row::new(vec!["NODE", "STATE", "PROOF", "IP"])
            .style(theme::label())
            .bottom_margin(0),
    )
    .block(retro_block("NODES  j/k · Enter", true));

    frame.render_widget(table, area);
}

fn render_node_detail(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    app: &DashboardApp,
    api: Option<&crate::status::ControlAPIStatus>,
    side_panel: bool,
) {
    let title = if side_panel {
        "DETAIL"
    } else {
        "DETAIL  Esc back"
    };
    let Some(api) = api else {
        frame.render_widget(
            Paragraph::new(" Waiting for Control API…").block(panel_block(title, true)),
            area,
        );
        return;
    };
    let Some(n) = api.nodes.get(app.node_cursor) else {
        frame.render_widget(
            Paragraph::new(" Select a node with j/k").block(panel_block(title, true)),
            area,
        );
        return;
    };

    let status_label = n.status.to_ascii_uppercase();
    let status_span = Span::styled(
        format!(" {status_label} "),
        theme::status_badge(&status_label),
    );
    let proof = if n.latest_heartbeat_verified {
        Span::styled(" PROOF OK ", theme::ok_badge())
    } else if !n.latest_heartbeat_verification_error.is_empty() {
        Span::styled(
            format!(
                " FAIL {} ",
                truncate(&n.latest_heartbeat_verification_error, 28)
            ),
            theme::alert_badge(),
        )
    } else {
        Span::styled(" UNSIGNED ", theme::warn_badge())
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled(n.name.clone(), theme::value().add_modifier(Modifier::BOLD)),
            Span::raw("  "),
            status_span,
            Span::raw(" "),
            proof,
        ]),
        Line::from(""),
        line_kv("ID", truncate(&n.id, 36)),
        line_kv(
            "GATEWAY",
            if n.gateway_node_id.is_empty() {
                "—".to_string()
            } else {
                truncate(&n.gateway_node_id, 36)
            },
        ),
        line_kv(
            "IP",
            if n.ip_address.is_empty() {
                "—".to_string()
            } else {
                n.ip_address.clone()
            },
        ),
        line_kv(
            "HOTKEY",
            if n.hotkey.is_empty() {
                "—".to_string()
            } else {
                truncate(&n.hotkey, 28)
            },
        ),
        line_kv(
            "SIGNER",
            if n.latest_heartbeat_signer.is_empty() {
                "—".to_string()
            } else {
                truncate(&n.latest_heartbeat_signer, 28)
            },
        ),
        Line::from(""),
        Line::from(Span::styled(
            "UNSIGNED = proof not verified yet; node can still be ONLINE",
            theme::dim(),
        )),
    ];
    if !side_panel {
        lines.push(Line::from(Span::styled("Esc back to list", theme::muted())));
    }

    frame.render_widget(Paragraph::new(lines).block(panel_block(title, true)), area);
}

fn render_logs(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    app: &DashboardApp,
    snap: Option<&OperatorSnapshot>,
) {
    let is_err = |l: &str| {
        let l = l.to_ascii_lowercase();
        l.contains("error") || l.contains("lost") || l.contains("fail") || l.contains("warn")
    };

    let all_lines: Vec<Line> = snap
        .map(|s| {
            let filtered: Vec<&String> = if app.log_errors_only {
                s.log_tail.iter().filter(|l| is_err(l)).collect()
            } else {
                s.log_tail.iter().collect()
            };
            if filtered.is_empty() {
                vec![Line::from(Span::styled(
                    if app.log_errors_only {
                        " no errors — press a for all logs "
                    } else {
                        " log empty — run `provider-node start` in another terminal "
                    },
                    theme::muted(),
                ))]
            } else {
                filtered
                    .iter()
                    .map(|l| {
                        Line::from(Span::styled(
                            format!("› {l}"),
                            if is_err(l) {
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

    let title = format!(
        "LOG STREAM  {}/{}  j/k scroll · e errors · w wrap {}",
        scroll + 1,
        max_scroll + 1,
        if app.log_errors_only { "[errors]" } else { "" }
    );
    let para = Paragraph::new(window).block(retro_block(&title, true));
    let para = if app.log_wrap {
        para.wrap(Wrap { trim: true })
    } else {
        para
    };
    frame.render_widget(para, area);
}

fn render_command_bar(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    refresh_ms: u64,
    app: &DashboardApp,
    sync_hint: &str,
) {
    let context = match app.tab {
        Tab::Overview => "1-5 tabs · r refresh · d doctor · ? · q",
        Tab::Network => "1-5 tabs · r refresh · ? · q",
        Tab::Nodes => "j/k select · Enter detail · Esc · r · q",
        Tab::Earnings => "1-5 tabs · r refresh · ? · q",
        Tab::Logs => "j/k scroll · e errors · a all · w wrap · q",
    };
    let mut spans = vec![
        Span::styled(" ", theme::dim()),
        Span::styled(context, theme::dim()),
        Span::styled(format!("  ·  {refresh_ms}ms"), theme::muted()),
    ];
    if !sync_hint.is_empty() {
        spans.push(Span::styled(format!("  {sync_hint}"), theme::warn()));
    }
    if let Some(hint) = active_hint(app) {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(hint.to_string(), theme::label()));
    }
    spans.push(Span::raw("  "));
    spans.push(Span::styled(
        if app.tick % 24 < 12 { "▮" } else { "▯" },
        theme::value(),
    ));
    frame.render_widget(
        Paragraph::new(Line::from(spans)).style(Style::default().bg(theme::SURFACE)),
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
        Line::from(Span::styled(
            " PROXYHUB PROVIDER DASHBOARD ",
            theme::label(),
        )),
        Line::from(""),
        Line::from(Span::styled(" Navigation ", theme::value())),
        Line::from(Span::styled(
            "  1-5 / Tab / click   switch panels",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  j/k / wheel         scroll logs / nodes",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  Enter               node detail (Nodes tab)",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  Esc                 back / quit",
            theme::dim(),
        )),
        Line::from(""),
        Line::from(Span::styled(" Actions ", theme::value())),
        Line::from(Span::styled(
            "  r   refresh local + remote data",
            theme::dim(),
        )),
        Line::from(Span::styled("  d   re-run doctor checks", theme::dim())),
        Line::from(Span::styled(
            "  e/a errors only / all logs (Logs tab)",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  w   toggle log wrap (Logs tab)",
            theme::dim(),
        )),
        Line::from(Span::styled("  q   quit", theme::dim())),
        Line::from(""),
        Line::from(Span::styled(" Tabs ", theme::value())),
        Line::from(Span::styled(
            "  Overview  health, KPIs, alerts, doctor",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  Network   throughput, latency, sessions, gateway",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  Nodes     registry + per-node detail",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  Earnings  SOL totals + served bandwidth",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  Logs      live daemon log stream",
            theme::dim(),
        )),
        Line::from(""),
        Line::from(Span::styled(" Setup ", theme::value())),
        Line::from(Span::styled(
            "  provider-node                  # console (auto-starts daemon + menu)",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  provider-node dashboard          # TUI (auto-starts daemon in background)",
            theme::dim(),
        )),
        Line::from(Span::styled(
            "  provider-node start              # foreground daemon only",
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
        if let Some(err) = &rt.last_session_error {
            if is_auth_session_error(err) {
                return ("AUTH FAIL", theme::ALERT);
            }
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

fn is_auth_session_error(err: &str) -> bool {
    let m = err.to_ascii_lowercase();
    m.contains("invalid or inactive provider token")
        || m.contains("provider token expired")
        || m.contains("auth failed")
        || (m.contains("authentication failed") && m.contains("token"))
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
