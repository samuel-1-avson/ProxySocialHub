use crate::operator;
use anyhow::Result;
use crossterm::cursor::MoveTo;
use crossterm::terminal::{Clear, ClearType};
use crossterm::ExecutableCommand;
use std::io::stdout;
use std::path::PathBuf;
use std::time::Duration;
use tokio::signal;

pub async fn run(config_path: PathBuf, interval_ms: u64) -> Result<()> {
    let interval = Duration::from_millis(interval_ms.max(500));
    let mut stdout = stdout();

    loop {
        stdout.execute(Clear(ClearType::All))?;
        stdout.execute(MoveTo(0, 0))?;

        match operator::collect(config_path.clone()).await {
            Ok(snap) => operator::print_human(&snap),
            Err(e) => println!("Error: {e}"),
        }
        println!();
        println!(
            "(Ctrl+C to exit · refresh every {}ms)",
            interval.as_millis()
        );

        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = signal::ctrl_c() => break,
        }
    }
    Ok(())
}
