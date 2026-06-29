pub mod migrate;
pub mod models;

use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::Connection;

#[derive(thiserror::Error, Debug)]
pub enum DbError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, DbError>;

pub fn db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("app.db")
}

fn open_db(app_data_dir: &Path) -> Result<Connection> {
    fs::create_dir_all(app_data_dir)?;
    let path = db_path(app_data_dir);
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(conn)
}

pub fn init_db(app_data_dir: &Path) -> Result<Connection> {
    let conn = open_db(app_data_dir)?;
    migrate::migrate(&conn)?;
    Ok(conn)
}

pub fn connect_db(app_data_dir: &Path) -> Result<Connection> {
    open_db(app_data_dir)
}

pub fn init_db_for_app_start(app_data_dir: &Path) -> Result<Connection> {
    let conn = open_db(app_data_dir)?;
    models::fail_stale_running_collection_runs(&conn, "app restarted before collection finished")?;
    Ok(conn)
}

#[cfg(test)]
mod tests;
