//! Retro-minimal terminal palette (amber phosphor on warm black).

use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, BorderType, Borders};

pub const BG: Color = Color::Rgb(14, 12, 10);
pub const SURFACE: Color = Color::Rgb(22, 19, 15);
pub const AMBER: Color = Color::Rgb(255, 183, 77);
pub const PHOSPHOR: Color = Color::Rgb(143, 255, 140);
pub const DIM: Color = Color::Rgb(96, 86, 68);
pub const MUTED: Color = Color::Rgb(68, 60, 48);
pub const ALERT: Color = Color::Rgb(255, 108, 96);
pub const WARN: Color = Color::Rgb(255, 214, 102);
pub const BORDER: Color = Color::Rgb(72, 62, 48);

pub fn label() -> Style {
    Style::default().fg(AMBER).add_modifier(Modifier::BOLD)
}

pub fn value() -> Style {
    Style::default().fg(PHOSPHOR)
}

pub fn dim() -> Style {
    Style::default().fg(DIM)
}

pub fn muted() -> Style {
    Style::default().fg(MUTED)
}

pub fn alert() -> Style {
    Style::default().fg(ALERT).add_modifier(Modifier::BOLD)
}

pub fn warn() -> Style {
    Style::default().fg(WARN)
}

pub fn ok() -> Style {
    Style::default().fg(PHOSPHOR)
}

pub fn ok_badge() -> Style {
    Style::default()
        .fg(Color::Black)
        .bg(PHOSPHOR)
        .add_modifier(Modifier::BOLD)
}

pub fn warn_badge() -> Style {
    Style::default()
        .fg(Color::Black)
        .bg(WARN)
        .add_modifier(Modifier::BOLD)
}

pub fn alert_badge() -> Style {
    Style::default()
        .fg(Color::Black)
        .bg(ALERT)
        .add_modifier(Modifier::BOLD)
}

pub fn panel_border(focused: bool) -> Style {
    if focused {
        Style::default().fg(AMBER)
    } else {
        Style::default().fg(BORDER)
    }
}

pub fn retro_block<'a>(title: &'a str, focused: bool) -> Block<'a> {
    let title_line = if focused {
        format!("▌ {title} ▐")
    } else {
        format!(" {title} ")
    };
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .border_style(panel_border(focused))
        .title(title_line)
        .style(Style::default().bg(SURFACE))
}

pub fn status_badge(label: &str) -> Style {
    match label {
        "TUNNEL UP" | "ONLINE" => Style::default()
            .fg(Color::Black)
            .bg(PHOSPHOR)
            .add_modifier(Modifier::BOLD),
        "RECONNECTING" | "STARTING" => Style::default()
            .fg(Color::Black)
            .bg(WARN)
            .add_modifier(Modifier::BOLD),
        "STOPPED" | "OFFLINE" | "COLLECT ERROR" => Style::default()
            .fg(Color::Black)
            .bg(ALERT)
            .add_modifier(Modifier::BOLD),
        _ => Style::default()
            .fg(Color::Black)
            .bg(DIM)
            .add_modifier(Modifier::BOLD),
    }
}
