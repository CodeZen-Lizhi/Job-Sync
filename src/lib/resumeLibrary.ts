import type { JobCandidatePage } from "./jobs";
import { invoke } from "./tauri";

export interface ResumeRecord {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  is_default: boolean;
  linked_job_count: number;
}

export interface ResumeJobSummary {
  encrypt_job_id: string;
  position_name: string | null;
  brand_name: string | null;
  city_name: string | null;
  salary_desc: string | null;
  review_status: string | null;
  communication_status: string | null;
  linked_resume_id: string | null;
  linked_resume_title: string | null;
}

export interface ResumeLibraryState {
  resumes: ResumeRecord[];
  active_resume_id: string | null;
  default_resume_id: string | null;
  selected_resume: ResumeRecord | null;
  linked_jobs: ResumeJobSummary[];
}

export interface ResumeJobLinkStatus {
  encrypt_job_id: string;
  resume_id: string | null;
  resume_title: string | null;
  default_resume_id: string | null;
  default_resume_title: string | null;
}

export function getResumeLibraryState(selectedResumeId?: string | null): Promise<ResumeLibraryState> {
  return invoke<ResumeLibraryState>("get_resume_library_state", {
    selectedResumeId: selectedResumeId ?? null,
  });
}

export function createResume(title: string, body: string): Promise<ResumeLibraryState> {
  return invoke<ResumeLibraryState>("create_resume", { title, body });
}

export function updateResume(resumeId: string, title: string, body: string): Promise<ResumeLibraryState> {
  return invoke<ResumeLibraryState>("update_resume", { resumeId, title, body });
}

export function deleteResume(resumeId: string): Promise<ResumeLibraryState> {
  return invoke<ResumeLibraryState>("delete_resume", { resumeId });
}

export function setDefaultResume(resumeId: string | null): Promise<ResumeLibraryState> {
  return invoke<ResumeLibraryState>("set_default_resume", { resumeId });
}

export function linkResumeToJobs(resumeId: string, encryptJobIds: string[]): Promise<ResumeLibraryState> {
  return invoke<ResumeLibraryState>("link_resume_to_jobs", { resumeId, encryptJobIds });
}

export function unlinkResumeFromJob(encryptJobId: string): Promise<ResumeLibraryState> {
  return invoke<ResumeLibraryState>("unlink_resume_from_job", { encryptJobId });
}

export function getResumeStatusesForJobs(encryptJobIds: string[]): Promise<ResumeJobLinkStatus[]> {
  return invoke<ResumeJobLinkStatus[]>("get_resume_statuses_for_jobs", { encryptJobIds });
}

export function getResumeJobSummaries(encryptJobIds: string[]): Promise<ResumeJobSummary[]> {
  return invoke<ResumeJobSummary[]>("get_resume_job_summaries", { encryptJobIds });
}

export function listRecommendedJobsForResumeLinking(limit = 50): Promise<JobCandidatePage> {
  return invoke<JobCandidatePage>("list_job_candidates", {
    bucket: "recommended",
    query: null,
    startDate: null,
    endDate: null,
    processed: "unprocessed",
    statusFilters: [],
    aiAuditFilters: [],
    sourcePlatforms: [],
    collectionMethods: [],
    limit,
    offset: 0,
  });
}
