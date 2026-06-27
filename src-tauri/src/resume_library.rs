use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::{db, storage};

const LIBRARY_DIR: &str = "resume-library";
const INDEX_FILE: &str = "index.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResumeMeta {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResumeRecord {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_default: bool,
    pub linked_job_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResumeJobSummary {
    pub encrypt_job_id: String,
    pub position_name: Option<String>,
    pub brand_name: Option<String>,
    pub city_name: Option<String>,
    pub salary_desc: Option<String>,
    pub review_status: Option<String>,
    pub communication_status: Option<String>,
    pub linked_resume_id: Option<String>,
    pub linked_resume_title: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResumeLibraryState {
    pub resumes: Vec<ResumeRecord>,
    pub active_resume_id: Option<String>,
    pub default_resume_id: Option<String>,
    pub selected_resume: Option<ResumeRecord>,
    pub linked_jobs: Vec<ResumeJobSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResumeJobLinkStatus {
    pub encrypt_job_id: String,
    pub resume_id: Option<String>,
    pub resume_title: Option<String>,
    pub default_resume_id: Option<String>,
    pub default_resume_title: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ResolvedResume {
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ResumeLibraryIndex {
    #[serde(default)]
    active_resume_id: Option<String>,
    #[serde(default)]
    default_resume_id: Option<String>,
    #[serde(default)]
    resumes: Vec<ResumeMeta>,
    #[serde(default)]
    job_links: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ResumeBody {
    body: String,
}

impl ResumeLibraryIndex {
    fn normalize(&mut self) {
        let ids: BTreeSet<String> = self.resumes.iter().map(|resume| resume.id.clone()).collect();
        self.resumes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        self.job_links.retain(|_, resume_id| ids.contains(resume_id));
        if !self
            .default_resume_id
            .as_ref()
            .is_some_and(|id| ids.contains(id))
        {
            self.default_resume_id = None;
        }
        if !self
            .active_resume_id
            .as_ref()
            .is_some_and(|id| ids.contains(id))
        {
            self.active_resume_id = self.resumes.first().map(|resume| resume.id.clone());
        }
    }
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc().format(&Rfc3339).unwrap()
}

fn new_resume_id() -> String {
    format!("resume-{}", OffsetDateTime::now_utc().unix_timestamp_nanos())
}

fn library_dir(app_data_dir: &Path) -> PathBuf {
    storage::storage_dir(app_data_dir).join(LIBRARY_DIR)
}

fn index_path(app_data_dir: &Path) -> PathBuf {
    library_dir(app_data_dir).join(INDEX_FILE)
}

fn body_path(app_data_dir: &Path, resume_id: &str) -> PathBuf {
    library_dir(app_data_dir)
        .join("resumes")
        .join(format!("{resume_id}.json"))
}

fn clean_title(title: &str) -> Result<String, String> {
    let cleaned = title.trim();
    if cleaned.is_empty() {
        return Err("简历标题不能为空。".to_string());
    }
    Ok(cleaned.chars().take(120).collect())
}

fn clean_body(body: &str) -> Result<String, String> {
    let cleaned = body.trim();
    if cleaned.is_empty() {
        return Err("简历正文不能为空，请粘贴 Markdown 简历后保存。".to_string());
    }
    Ok(cleaned.to_string())
}

fn read_index(app_data_dir: &Path) -> Result<ResumeLibraryIndex, String> {
    let path = index_path(app_data_dir);
    let Some(value) = storage::read_json(&path).map_err(|e| e.to_string())? else {
        return Ok(ResumeLibraryIndex {
            active_resume_id: None,
            default_resume_id: None,
            resumes: Vec::new(),
            job_links: BTreeMap::new(),
        });
    };
    let mut index: ResumeLibraryIndex = serde_json::from_value(value).map_err(|e| e.to_string())?;
    index.normalize();
    Ok(index)
}

fn write_index(app_data_dir: &Path, index: &ResumeLibraryIndex) -> Result<(), String> {
    let value = serde_json::to_value(index).map_err(|e| e.to_string())?;
    storage::write_json(&index_path(app_data_dir), &value).map_err(|e| e.to_string())
}

fn read_body(app_data_dir: &Path, resume_id: &str) -> Result<String, String> {
    let path = body_path(app_data_dir, resume_id);
    let Some(value) = storage::read_json(&path).map_err(|e| e.to_string())? else {
        return Ok(String::new());
    };
    let body: ResumeBody = serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(body.body)
}

fn write_body(app_data_dir: &Path, resume_id: &str, body: &str) -> Result<(), String> {
    let value = serde_json::to_value(ResumeBody {
        body: body.to_string(),
    })
    .map_err(|e| e.to_string())?;
    storage::write_json(&body_path(app_data_dir, resume_id), &value).map_err(|e| e.to_string())
}

fn remove_body(app_data_dir: &Path, resume_id: &str) -> Result<(), String> {
    let path = body_path(app_data_dir, resume_id);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn link_count(index: &ResumeLibraryIndex, resume_id: &str) -> usize {
    index
        .job_links
        .values()
        .filter(|linked_resume_id| linked_resume_id.as_str() == resume_id)
        .count()
}

fn record_from_meta(
    app_data_dir: &Path,
    index: &ResumeLibraryIndex,
    meta: &ResumeMeta,
) -> Result<ResumeRecord, String> {
    Ok(ResumeRecord {
        id: meta.id.clone(),
        title: meta.title.clone(),
        body: read_body(app_data_dir, &meta.id)?,
        created_at: meta.created_at.clone(),
        updated_at: meta.updated_at.clone(),
        is_default: index.default_resume_id.as_deref() == Some(meta.id.as_str()),
        linked_job_count: link_count(index, &meta.id),
    })
}

fn find_meta_mut<'a>(
    index: &'a mut ResumeLibraryIndex,
    resume_id: &str,
) -> Result<&'a mut ResumeMeta, String> {
    index
        .resumes
        .iter_mut()
        .find(|resume| resume.id == resume_id)
        .ok_or_else(|| "未找到这份简历。".to_string())
}

fn find_meta<'a>(index: &'a ResumeLibraryIndex, resume_id: &str) -> Option<&'a ResumeMeta> {
    index.resumes.iter().find(|resume| resume.id == resume_id)
}

fn linked_jobs_for_resume(
    app_data_dir: &Path,
    index: &ResumeLibraryIndex,
    resume_id: &str,
) -> Result<Vec<ResumeJobSummary>, String> {
    let conn = db::init_db(app_data_dir).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for (job_id, linked_resume_id) in index
        .job_links
        .iter()
        .filter(|(_, linked_resume_id)| linked_resume_id.as_str() == resume_id)
    {
        let summary = conn
            .query_row(
                r#"
                SELECT
                  j.encrypt_job_id,
                  j.position_name,
                  j.brand_name,
                  j.city_name,
                  j.salary_desc,
                  COALESCE(rs.review_status, 'pending'),
                  COALESCE(rs.communication_status, 'not_contacted')
                FROM job j
                LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
                WHERE j.encrypt_job_id = ?1
                LIMIT 1
                "#,
                [job_id],
                |row| {
                    Ok(ResumeJobSummary {
                        encrypt_job_id: row.get(0)?,
                        position_name: row.get(1)?,
                        brand_name: row.get(2)?,
                        city_name: row.get(3)?,
                        salary_desc: row.get(4)?,
                        review_status: row.get(5)?,
                        communication_status: row.get(6)?,
                        linked_resume_id: Some(linked_resume_id.clone()),
                        linked_resume_title: find_meta(index, linked_resume_id)
                            .map(|resume| resume.title.clone()),
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(summary) = summary {
            out.push(summary);
        }
    }
    out.sort_by(|a, b| a.brand_name.cmp(&b.brand_name).then(a.position_name.cmp(&b.position_name)));
    Ok(out)
}

pub fn get_state(
    app_data_dir: &Path,
    selected_resume_id: Option<&str>,
) -> Result<ResumeLibraryState, String> {
    let mut index = read_index(app_data_dir)?;
    index.normalize();
    let resumes = index
        .resumes
        .iter()
        .map(|meta| record_from_meta(app_data_dir, &index, meta))
        .collect::<Result<Vec<_>, _>>()?;
    let selected_id = selected_resume_id
        .filter(|id| find_meta(&index, id).is_some())
        .map(ToString::to_string)
        .or_else(|| index.active_resume_id.clone())
        .or_else(|| index.resumes.first().map(|resume| resume.id.clone()));
    let selected_resume = selected_id
        .as_deref()
        .and_then(|id| resumes.iter().find(|resume| resume.id == id))
        .cloned();
    let linked_jobs = selected_id
        .as_deref()
        .map(|id| linked_jobs_for_resume(app_data_dir, &index, id))
        .transpose()?
        .unwrap_or_default();

    Ok(ResumeLibraryState {
        resumes,
        active_resume_id: selected_id,
        default_resume_id: index.default_resume_id,
        selected_resume,
        linked_jobs,
    })
}

pub fn create_resume(
    app_data_dir: &Path,
    title: &str,
    body: &str,
) -> Result<ResumeLibraryState, String> {
    let mut index = read_index(app_data_dir)?;
    let title = clean_title(title)?;
    let body = clean_body(body)?;
    let now = now_rfc3339();
    let id = new_resume_id();
    let meta = ResumeMeta {
        id: id.clone(),
        title,
        created_at: now.clone(),
        updated_at: now,
    };
    write_body(app_data_dir, &id, &body)?;
    index.active_resume_id = Some(id.clone());
    index.resumes.push(meta);
    index.normalize();
    write_index(app_data_dir, &index)?;
    get_state(app_data_dir, Some(&id))
}

pub fn update_resume(
    app_data_dir: &Path,
    resume_id: &str,
    title: &str,
    body: &str,
) -> Result<ResumeLibraryState, String> {
    let mut index = read_index(app_data_dir)?;
    let title = clean_title(title)?;
    let body = clean_body(body)?;
    let meta = find_meta_mut(&mut index, resume_id)?;
    meta.title = title;
    meta.updated_at = now_rfc3339();
    write_body(app_data_dir, resume_id, &body)?;
    index.active_resume_id = Some(resume_id.to_string());
    index.normalize();
    write_index(app_data_dir, &index)?;
    get_state(app_data_dir, Some(resume_id))
}

pub fn delete_resume(app_data_dir: &Path, resume_id: &str) -> Result<ResumeLibraryState, String> {
    let mut index = read_index(app_data_dir)?;
    if find_meta(&index, resume_id).is_none() {
        return Err("未找到这份简历。".to_string());
    }
    index.resumes.retain(|resume| resume.id != resume_id);
    if index.default_resume_id.as_deref() == Some(resume_id) {
        index.default_resume_id = None;
    }
    if index.active_resume_id.as_deref() == Some(resume_id) {
        index.active_resume_id = None;
    }
    index.job_links.retain(|_, linked_resume_id| linked_resume_id != resume_id);
    remove_body(app_data_dir, resume_id)?;
    index.normalize();
    write_index(app_data_dir, &index)?;
    get_state(app_data_dir, None)
}

pub fn set_default_resume(
    app_data_dir: &Path,
    resume_id: Option<&str>,
) -> Result<ResumeLibraryState, String> {
    let mut index = read_index(app_data_dir)?;
    if let Some(resume_id) = resume_id {
        if find_meta(&index, resume_id).is_none() {
            return Err("未找到这份简历，无法设为默认。".to_string());
        }
        index.default_resume_id = Some(resume_id.to_string());
        index.active_resume_id = Some(resume_id.to_string());
    } else {
        index.default_resume_id = None;
    }
    index.normalize();
    write_index(app_data_dir, &index)?;
    get_state(app_data_dir, resume_id)
}

pub fn link_resume_to_jobs(
    app_data_dir: &Path,
    resume_id: &str,
    encrypt_job_ids: Vec<String>,
) -> Result<ResumeLibraryState, String> {
    let mut index = read_index(app_data_dir)?;
    if find_meta(&index, resume_id).is_none() {
        return Err("未找到这份简历，无法关联岗位。".to_string());
    }
    for job_id in encrypt_job_ids {
        let cleaned = job_id.trim();
        if cleaned.is_empty() {
            continue;
        }
        index
            .job_links
            .insert(cleaned.to_string(), resume_id.to_string());
    }
    index.active_resume_id = Some(resume_id.to_string());
    index.normalize();
    write_index(app_data_dir, &index)?;
    get_state(app_data_dir, Some(resume_id))
}

pub fn unlink_resume_from_job(
    app_data_dir: &Path,
    encrypt_job_id: &str,
) -> Result<ResumeLibraryState, String> {
    let mut index = read_index(app_data_dir)?;
    let selected_resume_id = index.job_links.remove(encrypt_job_id);
    index.normalize();
    write_index(app_data_dir, &index)?;
    get_state(app_data_dir, selected_resume_id.as_deref())
}

pub fn get_status_for_job(
    app_data_dir: &Path,
    encrypt_job_id: &str,
) -> Result<ResumeJobLinkStatus, String> {
    let index = read_index(app_data_dir)?;
    let linked_resume_id = index.job_links.get(encrypt_job_id).cloned();
    let linked_resume_title = linked_resume_id
        .as_deref()
        .and_then(|id| find_meta(&index, id))
        .map(|resume| resume.title.clone());
    let default_resume_title = index
        .default_resume_id
        .as_deref()
        .and_then(|id| find_meta(&index, id))
        .map(|resume| resume.title.clone());

    Ok(ResumeJobLinkStatus {
        encrypt_job_id: encrypt_job_id.to_string(),
        resume_id: linked_resume_id.filter(|id| find_meta(&index, id).is_some()),
        resume_title: linked_resume_title,
        default_resume_id: index.default_resume_id,
        default_resume_title,
    })
}

pub fn get_statuses_for_jobs(
    app_data_dir: &Path,
    encrypt_job_ids: Vec<String>,
) -> Result<Vec<ResumeJobLinkStatus>, String> {
    encrypt_job_ids
        .iter()
        .map(|job_id| get_status_for_job(app_data_dir, job_id))
        .collect()
}

pub fn resolve_resume_text_for_job(
    app_data_dir: &Path,
    encrypt_job_id: &str,
) -> Result<Option<ResolvedResume>, String> {
    let index = read_index(app_data_dir)?;
    let linked_resume_id = index
        .job_links
        .get(encrypt_job_id)
        .filter(|id| find_meta(&index, id).is_some())
        .cloned();
    let candidate = linked_resume_id
        .map(|id| id)
        .or_else(|| {
            index
                .default_resume_id
                .as_ref()
                .filter(|id| find_meta(&index, id).is_some())
                .map(|id| id.clone())
        });
    let Some(resume_id) = candidate else {
        return Ok(None);
    };
    if find_meta(&index, &resume_id).is_none() {
        return Ok(None);
    }
    let body = read_body(app_data_dir, &resume_id)?;
    if body.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(ResolvedResume { body }))
}

pub fn job_summary_for_ids(
    app_data_dir: &Path,
    encrypt_job_ids: Vec<String>,
) -> Result<Vec<ResumeJobSummary>, String> {
    let index = read_index(app_data_dir)?;
    let conn = db::init_db(app_data_dir).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for job_id in encrypt_job_ids {
        let summary = conn
            .query_row(
                r#"
                SELECT
                  j.encrypt_job_id,
                  j.position_name,
                  j.brand_name,
                  j.city_name,
                  j.salary_desc,
                  COALESCE(rs.review_status, 'pending'),
                  COALESCE(rs.communication_status, 'not_contacted')
                FROM job j
                LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
                WHERE j.encrypt_job_id = ?1
                LIMIT 1
                "#,
                params![job_id],
                |row| {
                    let encrypt_job_id: String = row.get(0)?;
                    let linked_resume_id = index.job_links.get(&encrypt_job_id).cloned();
                    let linked_resume_title = linked_resume_id
                        .as_deref()
                        .and_then(|id| find_meta(&index, id))
                        .map(|resume| resume.title.clone());
                    Ok(ResumeJobSummary {
                        encrypt_job_id,
                        position_name: row.get(1)?,
                        brand_name: row.get(2)?,
                        city_name: row.get(3)?,
                        salary_desc: row.get(4)?,
                        review_status: row.get(5)?,
                        communication_status: row.get(6)?,
                        linked_resume_id,
                        linked_resume_title,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(summary) = summary {
            out.push(summary);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app_data_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    #[test]
    fn default_resume_is_manual() {
        let tmp = app_data_dir();
        let first = create_resume(tmp.path(), "基础版", "# A").expect("create first");
        let first_id = first.selected_resume.expect("selected").id;
        let second = create_resume(tmp.path(), "岗位版", "# B").expect("create second");
        let second_id = second.selected_resume.expect("selected").id;

        let state = get_state(tmp.path(), None).expect("state");
        assert_eq!(state.default_resume_id, None);

        let state = set_default_resume(tmp.path(), Some(&first_id)).expect("set default");
        assert_eq!(state.default_resume_id.as_deref(), Some(first_id.as_str()));
        update_resume(tmp.path(), &second_id, "岗位版更新", "# B2").expect("update");

        let state = get_state(tmp.path(), None).expect("state");
        assert_eq!(state.default_resume_id.as_deref(), Some(first_id.as_str()));
    }

    #[test]
    fn one_job_has_one_resume_and_resume_has_many_jobs() {
        let tmp = app_data_dir();
        let first = create_resume(tmp.path(), "基础版", "# A").expect("create first");
        let first_id = first.selected_resume.expect("selected").id;
        let second = create_resume(tmp.path(), "岗位版", "# B").expect("create second");
        let second_id = second.selected_resume.expect("selected").id;

        link_resume_to_jobs(
            tmp.path(),
            &first_id,
            vec!["job-1".to_string(), "job-2".to_string()],
        )
        .expect("link first");
        let status = get_status_for_job(tmp.path(), "job-1").expect("status");
        assert_eq!(status.resume_id.as_deref(), Some(first_id.as_str()));

        link_resume_to_jobs(tmp.path(), &second_id, vec!["job-1".to_string()])
            .expect("overwrite");
        let job_1 = get_status_for_job(tmp.path(), "job-1").expect("status");
        let job_2 = get_status_for_job(tmp.path(), "job-2").expect("status");
        assert_eq!(job_1.resume_id.as_deref(), Some(second_id.as_str()));
        assert_eq!(job_2.resume_id.as_deref(), Some(first_id.as_str()));

        let state = get_state(tmp.path(), Some(&first_id)).expect("state");
        assert_eq!(state.selected_resume.expect("selected").linked_job_count, 1);
    }

    #[test]
    fn deleting_resume_clears_default_and_links() {
        let tmp = app_data_dir();
        let state = create_resume(tmp.path(), "基础版", "# A").expect("create");
        let resume_id = state.selected_resume.expect("selected").id;
        set_default_resume(tmp.path(), Some(&resume_id)).expect("default");
        link_resume_to_jobs(tmp.path(), &resume_id, vec!["job-1".to_string()]).expect("link");

        let state = delete_resume(tmp.path(), &resume_id).expect("delete");
        assert_eq!(state.default_resume_id, None);
        assert!(state.resumes.is_empty());
        let status = get_status_for_job(tmp.path(), "job-1").expect("status");
        assert_eq!(status.resume_id, None);
    }

    #[test]
    fn resume_resolution_prefers_link_then_default() {
        let tmp = app_data_dir();
        let default_state = create_resume(tmp.path(), "默认", "# Default").expect("default");
        let default_id = default_state.selected_resume.expect("selected").id;
        let linked_state = create_resume(tmp.path(), "定制", "# Linked").expect("linked");
        let linked_id = linked_state.selected_resume.expect("selected").id;
        set_default_resume(tmp.path(), Some(&default_id)).expect("set default");
        link_resume_to_jobs(tmp.path(), &linked_id, vec!["job-1".to_string()]).expect("link");

        let linked = resolve_resume_text_for_job(tmp.path(), "job-1")
            .expect("resolve")
            .expect("linked");
        assert_eq!(linked.body, "# Linked");

        let fallback = resolve_resume_text_for_job(tmp.path(), "job-2")
            .expect("resolve")
            .expect("default");
        assert_ne!(linked_id, default_id);
        assert_eq!(fallback.body, "# Default");
    }
}
