use std::{
    env, fs,
    path::{Path, PathBuf},
};

use tauri::Manager;

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

pub fn resolve_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
        if let Some(root) = find_project_root(&cwd) {
            let data_dir = root.join("data");
            fs::create_dir_all(&data_dir).map_err(|e| format!("failed to create data dir: {e}"))?;
            return Ok(data_dir);
        }
    }

    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app_data_dir: {e}"))?;
    fs::create_dir_all(&fallback).map_err(|e| format!("failed to create app_data_dir: {e}"))?;
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
}
