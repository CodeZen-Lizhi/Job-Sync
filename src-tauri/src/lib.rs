#![allow(clippy::needless_return)]

use tauri::Manager;

mod commands;
mod db;
mod ipc;
mod paths;
mod resume_pdf_support;
mod resume_pdf_template;
mod resume_text;
mod resume_workspace;
mod resume_workspaces;
mod settings;
mod sidecar;
mod storage;
mod worker;

#[cfg(test)]
mod resume_workspace_tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = paths::resolve_data_dir(app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(sidecar::SidecarManager::new(app.handle().clone(), data_dir));
            if let Some(window) = app.get_webview_window("main") {
                if let Err(err) = window.center() {
                    eprintln!("failed to center window: {err}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::start_login,
            commands::auth::get_login_status,
            commands::crawl::crawl_manual_start,
            commands::crawl::crawl_auto_start,
            commands::crawl::crawl_stop,
            commands::crawl::get_boss_meta,
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
            commands::jobs::send_daily_job_intelligence_wecom_notification,
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
            commands::ai::analyze_resume_for_job,
            commands::ai::analyze_profile_for_jobs,
            commands::ai::generate_greeting_message,
            commands::ai::generate_ai_company_scores,
            commands::ai::list_ai_reports,
            commands::ai::clear_ai_reports,
            commands::ai::get_ai_report,
            commands::ai::list_models,
            commands::settings::get_settings,
            commands::settings::diagnose_external_dependencies,
            commands::settings::set_browser_executable_path,
            commands::settings::set_ai_settings,
            commands::settings::save_settings,
            commands::resume_workspace::get_resume_workspace_state,
            commands::resume_workspace::get_resume_workspace_status_for_job,
            commands::resume_workspace::create_resume_workspace,
            commands::resume_workspace::switch_resume_workspace,
            commands::resume_workspace::rename_resume_workspace,
            commands::resume_workspace::delete_resume_workspace,
            commands::resume_workspace::save_resume_workspace_draft,
            commands::resume_workspace::diagnose_resume_workspace,
            commands::resume_workspace::rewrite_resume_workspace_module,
            commands::resume_workspace::assemble_resume_workspace,
            commands::resume_workspace::export_resume_workspace_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
