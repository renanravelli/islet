//! Logs to stderr and to `~/Library/Logs/<bundle id>/islet.<date>.log` (the native host writes
//! next to it), daily rotation, at most 7 files. `ISLET_LOG` sets the level (default info). No
//! names, titles, meeting codes or message content, ever.

use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::writer::MakeWriterExt;

const MAX_LOG_FILES: usize = 7;

pub fn init() {
    let level = std::env::var("ISLET_LOG")
        .ok()
        .and_then(|level| level.parse::<tracing::level_filters::LevelFilter>().ok())
        .unwrap_or(tracing::level_filters::LevelFilter::INFO);
    let file = islet_bridge::path::log_dir().and_then(|dir| {
        let _ = std::fs::create_dir_all(&dir);
        RollingFileAppender::builder()
            .rotation(Rotation::DAILY)
            .filename_prefix("islet")
            .filename_suffix("log")
            .max_log_files(MAX_LOG_FILES)
            .build(dir)
            .ok()
    });
    let builder = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_target(false)
        .with_max_level(level);
    match file {
        Some(file) => builder.with_writer(std::io::stderr.and(file)).init(),
        None => builder.with_writer(std::io::stderr).init(),
    }
}
