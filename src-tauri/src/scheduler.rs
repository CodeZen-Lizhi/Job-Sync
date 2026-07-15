use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const CRAWL_SCHEDULE_EVENT: &str = "crawl-schedule://due";

#[derive(Debug, Clone, Serialize)]
pub struct CrawlScheduleDueEvent {
    pub version: u64,
    pub generation: u64,
    pub scheduled_at_ms: i64,
}

#[derive(Debug, Default)]
struct ScheduleState {
    next_run_at_ms: Option<i64>,
    request_version: u64,
    generation: u64,
    stopped: bool,
}

impl ScheduleState {
    fn update(&mut self, next_run_at_ms: Option<i64>, request_version: u64) {
        if request_version < self.request_version {
            return;
        }

        self.request_version = request_version;
        self.generation = self.generation.wrapping_add(1);
        self.next_run_at_ms = next_run_at_ms;
    }

    fn take_due(&mut self, now_ms: i64) -> Option<CrawlScheduleDueEvent> {
        let scheduled_at_ms = self.next_run_at_ms?;
        if now_ms < scheduled_at_ms {
            return None;
        }

        self.next_run_at_ms = None;
        Some(CrawlScheduleDueEvent {
            version: self.request_version,
            generation: self.generation,
            scheduled_at_ms,
        })
    }
}

struct SchedulerInner {
    state: Mutex<ScheduleState>,
    changed: Condvar,
}

pub struct CrawlScheduleManager {
    inner: Arc<SchedulerInner>,
    worker: Option<JoinHandle<()>>,
}

impl CrawlScheduleManager {
    pub fn new(app: AppHandle) -> Self {
        let inner = Arc::new(SchedulerInner {
            state: Mutex::new(ScheduleState::default()),
            changed: Condvar::new(),
        });
        let worker_inner = Arc::clone(&inner);
        let worker = thread::Builder::new()
            .name("crawl-schedule".to_string())
            .spawn(move || run_scheduler(app, worker_inner))
            .expect("创建定时采集后台线程失败");

        Self {
            inner,
            worker: Some(worker),
        }
    }

    pub fn update(&self, next_run_at_ms: Option<i64>, request_version: u64) {
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.update(next_run_at_ms, request_version);
        self.inner.changed.notify_one();
    }
}

impl Drop for CrawlScheduleManager {
    fn drop(&mut self) {
        {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.stopped = true;
            state.next_run_at_ms = None;
        }
        self.inner.changed.notify_one();

        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn run_scheduler(app: AppHandle, inner: Arc<SchedulerInner>) {
    loop {
        let due_event = {
            let mut state = inner
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());

            loop {
                if state.stopped {
                    return;
                }

                let Some(next_run_at_ms) = state.next_run_at_ms else {
                    state = inner
                        .changed
                        .wait(state)
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    continue;
                };

                let now_ms = current_time_ms();
                if let Some(event) = state.take_due(now_ms) {
                    break Some(event);
                }

                let wait_ms = next_run_at_ms.saturating_sub(now_ms) as u64;
                state = inner
                    .changed
                    .wait_timeout(state, Duration::from_millis(wait_ms))
                    .map(|(guard, _)| guard)
                    .unwrap_or_else(|poisoned| poisoned.into_inner().0);
            }
        };

        if let Some(event) = due_event {
            if let Err(error) = app.emit(CRAWL_SCHEDULE_EVENT, event) {
                eprintln!("发送定时采集事件失败：{error}");
            }
        }
    }
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::ScheduleState;

    #[test]
    fn ignores_out_of_order_schedule_updates() {
        let mut state = ScheduleState::default();

        state.update(Some(2_000), 2);
        state.update(Some(1_000), 1);

        assert_eq!(state.next_run_at_ms, Some(2_000));
        assert_eq!(state.request_version, 2);
    }

    #[test]
    fn due_schedule_is_consumed_once() {
        let mut state = ScheduleState::default();
        state.update(Some(1_000), 1);

        let event = state.take_due(1_001).expect("应产生到期事件");
        assert_eq!(event.version, 1);
        assert_eq!(event.scheduled_at_ms, 1_000);
        assert!(state.take_due(1_002).is_none());
    }

    #[test]
    fn schedule_before_deadline_is_not_due() {
        let mut state = ScheduleState::default();
        state.update(Some(2_000), 1);

        assert!(state.take_due(1_999).is_none());
        assert_eq!(state.next_run_at_ms, Some(2_000));
    }

    #[test]
    fn cancelling_schedule_clears_pending_due() {
        let mut state = ScheduleState::default();
        state.update(Some(1_000), 1);
        state.update(None, 2);

        assert!(state.take_due(10_000).is_none());
        assert_eq!(state.request_version, 2);
    }
}
