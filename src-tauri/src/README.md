# Tauri Rust Source

This directory contains the Rust application entrypoints, command handlers, storage, and domain services for the desktop app.

## Notable files and modules

- `main.rs`, `lib.rs` — Tauri application bootstrap and command registration.
- `commands/` — Tauri command handlers for crawling, jobs, exports, AI features, and settings.
- `db/` — SQLite models, migrations, and database helpers.
- `ipc/` — shared IPC protocol definitions.
- `paths.rs`, `settings.rs`, `storage/`, `sidecar/`, `worker.rs` — filesystem paths, settings persistence, local storage, sidecar control, and worker orchestration, including bundled `node` / `node.exe` + `boss-crawler-worker/` runtime discovery for release/portable builds plus development-mode Node fallback.
- `resume_text.rs` — resolves resume text from raw input or files.

## Windows 便携版运行前提

- 系统已安装 WebView2 Runtime
- 系统已安装 Chrome 或 Edge
- 或用户在设置页中配置浏览器可执行文件路径

便携版目录包含：

- `job-sync.exe`
- `node.exe`
- `boss-crawler-worker/`
