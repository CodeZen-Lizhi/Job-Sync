use tauri::State;

use crate::scheduler::CrawlScheduleManager;

/// 更新或取消定时采集的下一次后台唤醒时间。
///
/// `request_version` 用于丢弃前端异步调用乱序到达的旧计划。
#[tauri::command]
pub fn update_crawl_schedule(
    scheduler: State<'_, CrawlScheduleManager>,
    next_run_at_ms: Option<i64>,
    request_version: u64,
) -> Result<(), String> {
    scheduler.update(next_run_at_ms, request_version);
    Ok(())
}
