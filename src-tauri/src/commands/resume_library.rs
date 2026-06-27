use tauri::AppHandle;

use crate::{
    paths, resume_library,
    resume_library::{ResumeJobLinkStatus, ResumeJobSummary, ResumeLibraryState},
};

#[tauri::command]
pub fn get_resume_library_state(
    app: AppHandle,
    selected_resume_id: Option<String>,
) -> Result<ResumeLibraryState, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::get_state(&app_data_dir, selected_resume_id.as_deref())
}

#[tauri::command]
pub fn create_resume(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<ResumeLibraryState, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::create_resume(&app_data_dir, &title, &body)
}

#[tauri::command]
pub fn update_resume(
    app: AppHandle,
    resume_id: String,
    title: String,
    body: String,
) -> Result<ResumeLibraryState, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::update_resume(&app_data_dir, &resume_id, &title, &body)
}

#[tauri::command]
pub fn delete_resume(app: AppHandle, resume_id: String) -> Result<ResumeLibraryState, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::delete_resume(&app_data_dir, &resume_id)
}

#[tauri::command]
pub fn set_default_resume(
    app: AppHandle,
    resume_id: Option<String>,
) -> Result<ResumeLibraryState, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::set_default_resume(&app_data_dir, resume_id.as_deref())
}

#[tauri::command]
pub fn link_resume_to_jobs(
    app: AppHandle,
    resume_id: String,
    encrypt_job_ids: Vec<String>,
) -> Result<ResumeLibraryState, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::link_resume_to_jobs(&app_data_dir, &resume_id, encrypt_job_ids)
}

#[tauri::command]
pub fn unlink_resume_from_job(
    app: AppHandle,
    encrypt_job_id: String,
) -> Result<ResumeLibraryState, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::unlink_resume_from_job(&app_data_dir, &encrypt_job_id)
}

#[tauri::command]
pub fn get_resume_status_for_job(
    app: AppHandle,
    encrypt_job_id: String,
) -> Result<ResumeJobLinkStatus, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::get_status_for_job(&app_data_dir, &encrypt_job_id)
}

#[tauri::command]
pub fn get_resume_statuses_for_jobs(
    app: AppHandle,
    encrypt_job_ids: Vec<String>,
) -> Result<Vec<ResumeJobLinkStatus>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::get_statuses_for_jobs(&app_data_dir, encrypt_job_ids)
}

#[tauri::command]
pub fn get_resume_job_summaries(
    app: AppHandle,
    encrypt_job_ids: Vec<String>,
) -> Result<Vec<ResumeJobSummary>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    resume_library::job_summary_for_ids(&app_data_dir, encrypt_job_ids)
}
