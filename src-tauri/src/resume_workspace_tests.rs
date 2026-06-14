use tempfile::tempdir;

use crate::{
    resume_workspace::{self, ResumeWorkspaceDraft},
    resume_workspaces::{self, CreateResumeWorkspaceRequest},
};

#[test]
fn migrates_legacy_single_draft_into_first_workspace() {
    let tmp = tempdir().expect("tempdir");
    let app_data_dir = tmp.path();

    let legacy = ResumeWorkspaceDraft {
        original_resume_text: "legacy resume body".to_string(),
        ..ResumeWorkspaceDraft::default()
    };
    let saved = resume_workspace::save_draft(app_data_dir, legacy).expect("save legacy draft");
    assert_eq!(saved.original_resume_text, "legacy resume body");

    let state = resume_workspaces::get_state(app_data_dir).expect("migrate legacy state");
    assert_eq!(state.workspaces.len(), 1);
    assert_eq!(state.active_workspace_id, state.workspaces[0].id);
    assert_eq!(state.draft.original_resume_text, "legacy resume body");
}

#[test]
fn deleting_active_workspace_reassigns_active_to_remaining_workspace() {
    let tmp = tempdir().expect("tempdir");
    let app_data_dir = tmp.path();

    let first = resume_workspaces::create_workspace(
        app_data_dir,
        CreateResumeWorkspaceRequest {
            title: Some("第一份简历".to_string()),
            ..CreateResumeWorkspaceRequest::default()
        },
    )
    .expect("create first workspace");
    let first_id = first.active_workspace_id.clone();

    let second = resume_workspaces::create_workspace(
        app_data_dir,
        CreateResumeWorkspaceRequest {
            title: Some("第二份简历".to_string()),
            ..CreateResumeWorkspaceRequest::default()
        },
    )
    .expect("create second workspace");
    let second_id = second.active_workspace_id.clone();

    let state = resume_workspaces::delete_workspace(app_data_dir, &second_id)
        .expect("delete current workspace");
    assert_eq!(state.active_workspace_id, first_id);
    assert_eq!(state.workspaces.len(), 1);
    assert_ne!(state.active_workspace_id, second_id);
}

#[test]
fn finds_latest_resume_workspace_status_for_linked_job() {
    let tmp = tempdir().expect("tempdir");
    let app_data_dir = tmp.path();

    let first = resume_workspaces::create_workspace(
        app_data_dir,
        CreateResumeWorkspaceRequest {
            title: Some("旧投递简历".to_string()),
            linked_job_id: Some("job-1".to_string()),
            ..CreateResumeWorkspaceRequest::default()
        },
    )
    .expect("create first workspace");
    let mut first_draft = first.draft;
    first_draft.summary.confirmed = Some("旧摘要".to_string());
    resume_workspaces::save_workspace_draft(app_data_dir, &first.active_workspace_id, first_draft)
        .expect("save first draft");

    let second = resume_workspaces::create_workspace(
        app_data_dir,
        CreateResumeWorkspaceRequest {
            title: Some("新投递简历".to_string()),
            linked_job_id: Some("job-1".to_string()),
            ..CreateResumeWorkspaceRequest::default()
        },
    )
    .expect("create second workspace");
    let mut second_draft = second.draft;
    second_draft.summary.confirmed = Some("新摘要".to_string());
    second_draft.projects.confirmed = Some("项目".to_string());
    second_draft.final_resume_text = Some("最终简历".to_string());
    second_draft.last_exported_pdf_path = Some("/tmp/job-1.pdf".to_string());
    second_draft.last_exported_pdf_at = Some("2026-06-14T08:00:00Z".to_string());
    resume_workspaces::save_workspace_draft(
        app_data_dir,
        &second.active_workspace_id,
        second_draft,
    )
    .expect("save second draft");

    let status = resume_workspaces::get_status_for_job(app_data_dir, "job-1")
        .expect("read linked status")
        .expect("linked status");
    assert_eq!(status.title, "新投递简历");
    assert_eq!(status.confirmed_modules, 2);
    assert!(status.has_final_resume);
    assert_eq!(
        status.last_exported_pdf_path.as_deref(),
        Some("/tmp/job-1.pdf")
    );
    let final_resume = resume_workspaces::get_final_resume_text_for_job(app_data_dir, "job-1")
        .expect("read linked final resume");
    assert_eq!(final_resume.as_deref(), Some("最终简历"));

    let missing =
        resume_workspaces::get_status_for_job(app_data_dir, "job-2").expect("read missing status");
    assert!(missing.is_none());
    let missing_final_resume =
        resume_workspaces::get_final_resume_text_for_job(app_data_dir, "job-2")
            .expect("read missing final resume");
    assert!(missing_final_resume.is_none());
}
