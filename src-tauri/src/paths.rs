use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

const LEGACY_IDENTIFIER: &str = "com.administrator.job-sync";

fn parse_data_dir_arg<I, S>(args: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter();

    while let Some(arg) = args.next() {
        let arg = arg.as_ref();
        if let Some(value) = arg.strip_prefix("--data-dir=") {
            return Some(PathBuf::from(value));
        }
        if let Some(value) = arg.strip_prefix("--job-sync-data-dir=") {
            return Some(PathBuf::from(value));
        }
        if arg == "--data-dir" || arg == "--job-sync-data-dir" {
            return args.next().map(|value| PathBuf::from(value.as_ref()));
        }
    }

    None
}

fn data_dir_arg() -> Option<PathBuf> {
    parse_data_dir_arg(env::args().skip(1))
}

fn looks_like_project_root(dir: &Path) -> bool {
    dir.join("package.json").is_file() && dir.join("src-tauri").is_dir()
}

fn find_project_root(start: &Path) -> Option<PathBuf> {
    let mut cursor = start;
    for _ in 0..12 {
        if looks_like_project_root(cursor) {
            return Some(cursor.to_path_buf());
        }
        cursor = cursor.parent()?;
    }
    None
}

fn project_data_dir(start: &Path, allow_project_data: bool) -> Option<PathBuf> {
    if !allow_project_data {
        return None;
    }
    find_project_root(start).map(|root| root.join("data"))
}

fn has_user_data(dir: &Path) -> bool {
    dir.join("settings.json").is_file() || db_has_user_rows(&dir.join("app.db"))
}

fn db_has_user_rows(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let Ok(conn) = Connection::open(path) else {
        return true;
    };

    for table in ["job", "collection_run", "filter_profile", "ai_report"] {
        let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} LIMIT 1)");
        match conn.query_row(&sql, [], |row| row.get::<_, i64>(0)) {
            Ok(value) if value > 0 => return true,
            Ok(_) => {}
            Err(_) => {}
        }
    }

    false
}

fn legacy_app_data_dir(app: &AppHandle) -> Option<PathBuf> {
    let current = app.path().app_data_dir().ok()?;
    let name = current.file_name()?.to_str()?;
    if name == LEGACY_IDENTIFIER {
        return None;
    }
    Some(current.with_file_name(LEGACY_IDENTIFIER))
}

fn backup_existing_data_dir(dir: &Path) -> io::Result<Option<PathBuf>> {
    if !dir.exists() || fs::read_dir(dir)?.next().is_none() {
        return Ok(None);
    }

    let backup = dir.with_file_name(format!(
        "{}.pre-jobpilot-migration-{}",
        dir.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("jobpilot-data"),
        unix_timestamp()
    ));
    fs::rename(dir, &backup)?;
    Ok(Some(backup))
}

fn unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn copy_dir_all(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_all(&source, &target)?;
        } else if file_type.is_file() {
            fs::copy(&source, &target)?;
        }
    }
    Ok(())
}

fn migrate_legacy_data_dir_if_needed(app: &AppHandle, data_dir: &Path) -> Result<(), String> {
    if has_user_data(data_dir) {
        return Ok(());
    }

    let Some(legacy_dir) = legacy_app_data_dir(app) else {
        return Ok(());
    };
    if !has_user_data(&legacy_dir) {
        return Ok(());
    }

    let _backup = backup_existing_data_dir(data_dir)
        .map_err(|e| format!("failed to backup empty JobPilot data dir: {e}"))?;
    copy_dir_all(&legacy_dir, data_dir)
        .map_err(|e| format!("failed to migrate legacy job-sync data: {e}"))?;
    Ok(())
}

pub fn resolve_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = env::var("JOB_SYNC_DATA_DIR") {
        let candidate = PathBuf::from(p);
        fs::create_dir_all(&candidate)
            .map_err(|e| format!("failed to create JOB_SYNC_DATA_DIR: {e}"))?;
        return Ok(candidate);
    }

    if let Some(candidate) = data_dir_arg() {
        fs::create_dir_all(&candidate).map_err(|e| format!("failed to create --data-dir: {e}"))?;
        return Ok(candidate);
    }

    if let Ok(cwd) = env::current_dir() {
        if let Some(data_dir) = project_data_dir(&cwd, cfg!(debug_assertions)) {
            fs::create_dir_all(&data_dir).map_err(|e| format!("failed to create data dir: {e}"))?;
            return Ok(data_dir);
        }
    }

    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app_data_dir: {e}"))?;
    fs::create_dir_all(&fallback).map_err(|e| format!("failed to create app_data_dir: {e}"))?;
    migrate_legacy_data_dir_if_needed(app, &fallback)?;
    Ok(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_root_detection_walks_up_from_nested_path() {
        let cwd = env::current_dir().expect("cwd");
        let root = if cwd.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
            cwd.parent().expect("repo root").to_path_buf()
        } else {
            cwd
        };
        let nested = root.join("src-tauri").join("src");

        assert_eq!(find_project_root(&nested).as_deref(), Some(root.as_path()));
    }

    #[test]
    fn project_data_dir_is_only_available_for_debug_builds() {
        let cwd = env::current_dir().expect("cwd");
        let root = if cwd.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
            cwd.parent().expect("repo root").to_path_buf()
        } else {
            cwd
        };
        let nested = root.join("src-tauri").join("src");
        let expected = root.join("data");

        assert_eq!(
            project_data_dir(&nested, true).as_deref(),
            Some(expected.as_path()),
        );
        assert_eq!(project_data_dir(&nested, false), None);
    }

    #[test]
    fn data_dir_arg_accepts_space_and_equals_forms() {
        assert_eq!(
            parse_data_dir_arg(["--data-dir", "/tmp/job-sync-smoke"]).as_deref(),
            Some(Path::new("/tmp/job-sync-smoke")),
        );
        assert_eq!(
            parse_data_dir_arg(["--job-sync-data-dir=/tmp/job-sync-smoke"]).as_deref(),
            Some(Path::new("/tmp/job-sync-smoke")),
        );
    }

    #[test]
    fn user_data_detection_checks_settings_or_database() {
        let tmp = tempfile::tempdir().expect("tempdir");
        assert!(!has_user_data(tmp.path()));

        fs::write(tmp.path().join("settings.json"), "{}").expect("settings");
        assert!(has_user_data(tmp.path()));

        fs::remove_file(tmp.path().join("settings.json")).expect("remove settings");
        fs::write(tmp.path().join("app.db"), "").expect("db");
        assert!(!has_user_data(tmp.path()));
    }

    #[test]
    fn user_data_detection_ignores_seed_only_database() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("app.db");
        let conn = Connection::open(&path).expect("db");
        conn.execute_batch(
            r#"
            CREATE TABLE job_sources (platform TEXT PRIMARY KEY);
            INSERT INTO job_sources (platform) VALUES ('boss');
            "#,
        )
        .expect("seed");

        assert!(!has_user_data(tmp.path()));
    }

    #[test]
    fn user_data_detection_counts_real_jobs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("app.db");
        let conn = Connection::open(&path).expect("db");
        conn.execute_batch(
            r#"
            CREATE TABLE job (encrypt_job_id TEXT PRIMARY KEY);
            INSERT INTO job (encrypt_job_id) VALUES ('job-1');
            "#,
        )
        .expect("job");

        assert!(has_user_data(tmp.path()));
    }

    #[test]
    fn copy_dir_all_copies_nested_files() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let from = tmp.path().join("from");
        let to = tmp.path().join("to");
        fs::create_dir_all(from.join("nested")).expect("mkdir");
        fs::write(from.join("settings.json"), "{}").expect("settings");
        fs::write(from.join("nested").join("app.db"), "db").expect("db");

        copy_dir_all(&from, &to).expect("copy");

        assert_eq!(fs::read_to_string(to.join("settings.json")).unwrap(), "{}");
        assert_eq!(
            fs::read_to_string(to.join("nested").join("app.db")).unwrap(),
            "db"
        );
    }
}
