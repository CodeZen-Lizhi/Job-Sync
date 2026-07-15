#![allow(clippy::needless_return)]

use tauri::Manager;

mod commands;
mod db;
mod ipc;
mod paths;
mod resume_library;
mod resume_text;
mod scheduler;
mod settings;
mod sidecar;
mod storage;
mod worker;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = paths::resolve_data_dir(app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            db::init_db_for_app_start(&data_dir)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(sidecar::SidecarManager::new(app.handle().clone(), data_dir));
            app.manage(scheduler::CrawlScheduleManager::new(app.handle().clone()));
            if let Some(window) = app.get_webview_window("main") {
                if let Err(err) = window.center() {
                    eprintln!("failed to center window: {err}");
                }
                if let Err(err) = window.show() {
                    eprintln!("failed to show main window: {err}");
                }
                if let Err(err) = window.set_focus() {
                    eprintln!("failed to focus main window: {err}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::start_login,
            commands::auth::get_login_status,
            commands::crawl::crawl_auto_start,
            commands::crawl::crawl_stop,
            commands::crawl::get_boss_meta,
            commands::crawl::get_collection_batch_summary,
            commands::crawl::list_collection_failures,
            commands::crawl::list_collection_run_inserted_job_ids,
            commands::crawl::list_collection_runs,
            commands::crawl::refresh_pending_job_evidence,
            commands::crawl::sync_boss_meta,
            commands::crawl::sync_boss_chat_status,
            commands::jobs::list_jobs,
            commands::jobs::list_job_candidates,
            commands::jobs::get_job,
            commands::jobs::list_source_keywords,
            commands::jobs::list_jobs_by_source,
            commands::jobs::list_review_candidates,
            commands::jobs::list_favorited_jobs,
            commands::jobs::list_application_ready_jobs,
            commands::jobs::list_communication_followup_jobs,
            commands::jobs::list_filtered_jobs,
            commands::jobs::list_pending_confirmation_jobs,
            commands::jobs::list_job_blacklist,
            commands::jobs::list_job_sources,
            commands::jobs::set_job_source_enabled,
            commands::jobs::get_daily_job_intelligence,
            commands::jobs::get_job_detail,
            commands::jobs::delete_job,
            commands::jobs::delete_all_jobs,
            commands::jobs::rebuild_job_fields,
            commands::jobs::rebuild_company_scores,
            commands::jobs::set_job_review_state,
            commands::jobs::set_job_review_notes,
            commands::jobs::set_company_review_state,
            commands::jobs::add_company_blacklist,
            commands::jobs::add_job_blacklist,
            commands::jobs::add_keyword_blacklist,
            commands::jobs::delete_job_blacklist,
            commands::filter_profile::get_default_filter_profile,
            commands::filter_profile::list_filter_profiles,
            commands::filter_profile::save_filter_profile,
            commands::filter_profile::set_default_filter_profile_id,
            commands::filter_profile::set_default_filter_profile,
            commands::filter_profile::recompute_default_filter_profile,
            commands::export::export_jobs_csv,
            commands::export::export_jobs_json,
            commands::ai::generate_greeting_message,
            commands::ai::generate_ai_company_scores,
            commands::ai::recompute_ai_post_collection_judgement,
            commands::ai::generate_optimized_resume_for_job,
            commands::ai::list_models,
            commands::resume_library::get_resume_library_state,
            commands::resume_library::get_resume_library_overview,
            commands::resume_library::get_resume_record,
            commands::resume_library::create_resume,
            commands::resume_library::update_resume,
            commands::resume_library::delete_resume,
            commands::resume_library::set_default_resume,
            commands::resume_library::link_resume_to_jobs,
            commands::resume_library::unlink_resume_from_job,
            commands::resume_library::get_resume_status_for_job,
            commands::resume_library::get_resume_statuses_for_jobs,
            commands::resume_library::get_resume_job_summaries,
            commands::schedule::update_crawl_schedule,
            commands::settings::get_settings,
            commands::settings::diagnose_external_dependencies,
            commands::settings::set_browser_executable_path,
            commands::settings::set_ai_settings,
            commands::settings::save_settings,
            commands::settings::save_collection_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
