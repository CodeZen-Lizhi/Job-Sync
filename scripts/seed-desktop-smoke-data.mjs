import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const defaultDataDir = path.join(projectRoot, ".tmp", "desktop-smoke-data");
const dataDir = path.resolve(process.argv[2] ?? process.env.JOB_SYNC_DATA_DIR ?? defaultDataDir);
const dbPath = path.join(dataDir, "app.db");
const schemaPath = path.join(projectRoot, "src-tauri", "src", "db", "schema.sql");
const now = new Date();
const today = now.toISOString().slice(0, 10);
const nowIso = now.toISOString();
const exportedPdfPath = path.join(dataDir, "exports", "smoke-resume-ready.pdf");
const workspaceId = "smoke-resume-ready";

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function json(value) {
  return JSON.stringify(value);
}

function runCommand(command, args, options = {}) {
  const { input, cwd = projectRoot } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

function insert(table, row) {
  const columns = Object.keys(row);
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((key) => sqlString(row[key])).join(", ")});`;
}

function jobRows() {
  return [
    {
      encrypt_job_id: "smoke-go-sre-top",
      source_platform: "boss",
      source_url: "https://www.zhipin.com/job_detail/smoke-go-sre-top.html",
      dedup_key: "boss:smoke-go-sre-top",
      position_name: "Go SRE 平台工程师",
      boss_name: "技术负责人",
      brand_name: "云原生研究院",
      city_name: "深圳",
      salary_desc: "35-55K",
      experience_name: "5-10年",
      degree_name: "本科",
      jd_text: "负责 Go、Kubernetes、Prometheus、CI/CD 平台工程建设，支持长期远程协作。",
      raw_payload_json: json({ workMode: "long_remote", source: "boss", smoke: true }),
      last_seen_at: `${today}T09:10:00Z`,
    },
    {
      encrypt_job_id: "smoke-ai-infra-ready",
      source_platform: "boss",
      source_url: "https://www.zhipin.com/job_detail/smoke-ai-infra-ready.html",
      dedup_key: "boss:smoke-ai-infra-ready",
      position_name: "AI Infra 工程师",
      boss_name: "AI 平台负责人",
      brand_name: "模型平台实验室",
      city_name: "上海",
      salary_desc: "40-65K",
      experience_name: "5-10年",
      degree_name: "本科",
      jd_text: "建设 AI Agent 平台、模型服务、Kubernetes 调度和可观测性体系，可远程沟通。",
      raw_payload_json: json({ workMode: "flex_remote", source: "boss", smoke: true }),
      last_seen_at: `${today}T08:40:00Z`,
    },
    {
      encrypt_job_id: "smoke-greeted-unread",
      source_platform: "boss",
      source_url: "https://www.zhipin.com/job_detail/smoke-greeted-unread.html",
      dedup_key: "boss:smoke-greeted-unread",
      position_name: "DevOps 云平台工程师",
      boss_name: "招聘经理",
      brand_name: "基础设施团队",
      city_name: "杭州",
      salary_desc: "30-45K",
      experience_name: "3-5年",
      degree_name: "本科",
      jd_text: "维护 Linux、Terraform、Docker、CI/CD 和 Prometheus 监控，支持弹性远程。",
      raw_payload_json: json({ workMode: "flex_remote", source: "boss", smoke: true }),
      last_seen_at: `${today}T07:35:00Z`,
    },
    {
      encrypt_job_id: "smoke-onsite-filtered",
      source_platform: "boss",
      source_url: "https://www.zhipin.com/job_detail/smoke-onsite-filtered.html",
      dedup_key: "boss:smoke-onsite-filtered",
      position_name: "驻场运维工程师",
      boss_name: "项目经理",
      brand_name: "外包交付中心",
      city_name: "北京",
      salary_desc: "18-25K",
      experience_name: "3-5年",
      degree_name: "大专",
      jd_text: "长期驻场客户现场，负责 Windows 运维和外包交付。",
      raw_payload_json: json({ workMode: "onsite", source: "boss", smoke: true }),
      last_seen_at: `${today}T06:20:00Z`,
    },
  ];
}

function filterReasons() {
  return new Map([
    [
      "smoke-go-sre-top",
      {
        eligible: true,
        blocked_by: [],
        matched_preferences: ["Go", "Kubernetes", "Prometheus", "长期远程"],
        missing_preferences: ["AI Infra"],
      },
    ],
    [
      "smoke-ai-infra-ready",
      {
        eligible: true,
        blocked_by: [],
        matched_preferences: ["AI Infra", "Kubernetes", "AI Agent", "弹性远程"],
        missing_preferences: [],
      },
    ],
    [
      "smoke-greeted-unread",
      {
        eligible: true,
        blocked_by: [],
        matched_preferences: ["DevOps", "Terraform", "Docker", "弹性远程"],
        missing_preferences: ["AI Infra"],
      },
    ],
    [
      "smoke-onsite-filtered",
      {
        eligible: false,
        blocked_by: [
          {
            rule_type: "must_not_keyword",
            field: "job_description",
            value: "驻场",
            reason: "JD 明确出现驻场要求",
          },
          {
            rule_type: "must_not_company",
            field: "brand_name",
            value: "外包交付中心",
            reason: "公司描述命中外包交付风险",
          },
        ],
        matched_preferences: [],
        missing_preferences: ["Go", "Kubernetes", "远程"],
      },
    ],
  ]);
}

function aiReports() {
  return [
    {
      encrypt_job_id: "smoke-go-sre-top",
      resume_hash: "smoke-resume",
      job_hash: "smoke-go-sre-top",
      kind: "resume",
      title: "Go SRE 平台工程师匹配报告",
      match_score: 94,
      jobs_count: 1,
      result_json: json({
        resume_match_score: 94,
        matched_stack: ["Go", "Kubernetes", "Prometheus"],
        matched_direction: ["SRE", "平台工程"],
        matched_resume_evidence: ["简历包含 Kubernetes 平台建设和 Go 服务治理经历"],
        missing_points: ["AWS 经验未明确"],
        confidence: 0.88,
      }),
      created_at: `${today}T10:00:00Z`,
    },
    {
      encrypt_job_id: "smoke-ai-infra-ready",
      resume_hash: "smoke-resume",
      job_hash: "smoke-ai-infra-ready",
      kind: "resume",
      title: "AI Infra 工程师匹配报告",
      match_score: 89,
      jobs_count: 1,
      result_json: json({
        resume_match_score: 89,
        matched_stack: ["Go", "Kubernetes", "CI/CD"],
        matched_direction: ["AI Infra", "AI Agent"],
        matched_resume_evidence: ["简历包含平台工程和模型服务治理经验"],
        missing_points: ["大规模训练平台经验待补充"],
        confidence: 0.84,
      }),
      created_at: `${today}T10:10:00Z`,
    },
    {
      encrypt_job_id: "smoke-greeted-unread",
      resume_hash: "smoke-resume",
      job_hash: "smoke-greeted-unread",
      kind: "resume",
      title: "DevOps 云平台工程师匹配报告",
      match_score: 82,
      jobs_count: 1,
      result_json: json({
        resume_match_score: 82,
        matched_stack: ["Docker", "Terraform", "Prometheus"],
        matched_direction: ["DevOps", "云原生"],
        matched_resume_evidence: ["简历包含 CI/CD 和基础设施自动化经验"],
        missing_points: ["岗位未明确 Go 研发深度"],
        confidence: 0.8,
      }),
      created_at: `${today}T10:20:00Z`,
    },
  ];
}

function buildSql() {
  const filters = filterReasons();
  const sql = [];

  sql.push("PRAGMA foreign_keys = ON;");
  sql.push("DELETE FROM ai_report;");
  sql.push("DELETE FROM job_filter_result;");
  sql.push("DELETE FROM job_review_state;");
  sql.push("DELETE FROM company_review_state;");
  sql.push("DELETE FROM job_blacklist;");
  sql.push("DELETE FROM company_score;");
  sql.push("DELETE FROM job_source_link;");
  sql.push("DELETE FROM job_detail_raw;");
  sql.push("DELETE FROM job;");
  sql.push("DELETE FROM filter_profile;");
  sql.push("DELETE FROM job_sources;");

  sql.push(
    insert("job_sources", {
      platform: "boss",
      display_name: "Boss 直聘",
      adapter_kind: "crawler",
      enabled: 1,
      config_json: json({ smoke: true }),
      created_at: nowIso,
      updated_at: nowIso,
    }),
  );

  sql.push(
    insert("filter_profile", {
      id: "desktop-smoke-profile",
      name: "桌面烟测：Boss-only 远程技术岗",
      profile_json: json({
        sourcePlatformMode: "boss_only",
        requiredKeywords: ["Go", "Kubernetes"],
        excludedKeywords: ["驻场", "外包", "培训", "电话销售"],
        preferredKeywords: ["长期远程", "AI Infra", "Prometheus"],
        scoreWeights: { resume: 0.6, preference: 0.25, company: 0.15 },
      }),
      is_default: 1,
      updated_at: nowIso,
    }),
  );

  for (const job of jobRows()) {
    sql.push(insert("job", job));
    sql.push(
      insert("job_detail_raw", {
        encrypt_job_id: job.encrypt_job_id,
        zp_data_json: json({ detail: job.jd_text, smoke: true }),
        fetched_at: job.last_seen_at,
      }),
    );
    sql.push(
      insert("job_source_link", {
        encrypt_job_id: job.encrypt_job_id,
        keyword: "Go Kubernetes remote",
        filters_json: json({ city: job.city_name, smoke: true }),
        captured_at: job.last_seen_at,
      }),
    );
    const reason = filters.get(job.encrypt_job_id);
    sql.push(
      insert("job_filter_result", {
        encrypt_job_id: job.encrypt_job_id,
        profile_id: "desktop-smoke-profile",
        eligible: reason?.eligible ? 1 : 0,
        reason_json: json(reason),
        updated_at: nowIso,
      }),
    );
  }

  sql.push(
    insert("job_review_state", {
      encrypt_job_id: "smoke-ai-infra-ready",
      review_status: "ready_to_apply",
      communication_status: "not_contacted",
      last_greeted_at: null,
      notes: "桌面烟测：已人工确认进入投递准备台",
      updated_at: `${today}T11:00:00Z`,
    }),
  );
  sql.push(
    insert("job_review_state", {
      encrypt_job_id: "smoke-greeted-unread",
      review_status: "pending",
      communication_status: "greeted_unread",
      last_greeted_at: `${today}T09:30:00Z`,
      notes: "桌面烟测：已打招呼未读，仍允许回到候选队列",
      updated_at: `${today}T11:05:00Z`,
    }),
  );
  sql.push(
    insert("job_review_state", {
      encrypt_job_id: "smoke-onsite-filtered",
      review_status: "pending",
      communication_status: "not_contacted",
      last_greeted_at: null,
      notes: "桌面烟测：应显示在过滤结果而不是 Top 20",
      updated_at: `${today}T11:10:00Z`,
    }),
  );

  for (const entry of [
    ["云原生研究院", 92, ["low_info_risk"], ["公开信息较少但 JD 技术栈匹配"], 0.78, 260],
    ["模型平台实验室", 88, [], ["AI Infra 与平台工程方向明确"], 0.82, 280],
    ["基础设施团队", 84, [], ["DevOps 与云原生职责清晰"], 0.8, 230],
    ["外包交付中心", 35, ["outsourcing_risk"], ["JD 出现外包交付和驻场"], 0.86, 210],
  ]) {
    sql.push(
      insert("company_score", {
        company_name: entry[0],
        company_score: entry[1],
        risk_flags_json: json(entry[2]),
        evidence_json: json(entry[3]),
        confidence: entry[4],
        source_text_len: entry[5],
        updated_at: nowIso,
      }),
    );
  }

  for (const report of aiReports()) {
    sql.push(insert("ai_report", report));
  }

  return `${sql.join("\n")}\n`;
}

async function writeResumeWorkspaceFixture() {
  const workspaceDir = path.join(dataDir, "resume-workspaces");
  await fs.mkdir(path.dirname(exportedPdfPath), { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(
    exportedPdfPath,
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "utf8",
  );

  const draft = {
    source_mode: "text",
    original_resume_text: "Go / Kubernetes / SRE / AI Infra 平台工程师烟测简历",
    original_resume_file: null,
    basic_profile: {
      name: "Smoke Candidate",
      gender: "",
      birth_or_age: "",
      education: "本科",
      phone: "",
      email: "smoke@example.com",
    },
    context_text: "目标岗位：AI Infra、Go、SRE、云原生平台工程。",
    linked_job_id: "smoke-ai-infra-ready",
    diagnosis: {
      overall_summary: "烟测诊断：简历与 AI Infra 平台工程方向匹配。",
      summary: { assessment: "聚焦 Go 与平台工程", missing_info: [], suggestions: [] },
      projects: { assessment: "包含 Kubernetes 平台经历", missing_info: [], suggestions: [] },
      experience: { assessment: "具备 SRE 与 DevOps 背景", missing_info: [], suggestions: [] },
      skills: { assessment: "技术栈覆盖 Go/Kubernetes/Prometheus", missing_info: [], suggestions: [] },
      next_steps: ["人工核对最终 PDF 后再投递"],
    },
    summary: { input: "", followup_input: "", candidate: null, notes: [], checklist: [], confirmed: "Go / Kubernetes / AI Infra 平台工程师，关注稳定性、可观测性与工程效率。", updated_at: nowIso },
    projects: { input: "", followup_input: "", candidate: null, notes: [], checklist: [], confirmed: "主导 Kubernetes 平台治理、Prometheus 可观测性建设和 CI/CD 自动化。", updated_at: nowIso },
    experience: { input: "", followup_input: "", candidate: null, notes: [], checklist: [], confirmed: "负责 Go 服务治理、SRE 值班体系和基础设施自动化落地。", updated_at: nowIso },
    skills: { input: "", followup_input: "", candidate: null, notes: [], checklist: [], confirmed: "Go, Kubernetes, Docker, Prometheus, Terraform, Linux, CI/CD。", updated_at: nowIso },
    final_resume_text: "Smoke Candidate\n\nGo / Kubernetes / AI Infra 平台工程师\n\n项目：Kubernetes 平台治理与 Prometheus 可观测性建设。",
    last_exported_pdf_path: exportedPdfPath,
    last_exported_pdf_at: nowIso,
    updated_at: nowIso,
  };

  const index = {
    active_workspace_id: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        title: "AI Infra 投递烟测简历",
        source_mode: "text",
        source_name: "文本简历",
        created_at: nowIso,
        updated_at: nowIso,
        has_diagnosis: true,
        confirmed_modules: 4,
        has_final_resume: true,
        linked_job_id: "smoke-ai-infra-ready",
        last_exported_pdf_path: exportedPdfPath,
        last_exported_pdf_at: nowIso,
      },
    ],
  };

  await fs.writeFile(path.join(workspaceDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(workspaceDir, `${workspaceId}.json`), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
}

async function main() {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });
  const schema = await fs.readFile(schemaPath, "utf8");
  await runCommand("sqlite3", [dbPath], { input: schema });
  await runCommand("sqlite3", [dbPath], { input: buildSql() });
  await writeResumeWorkspaceFixture();

  process.stdout.write(`Desktop smoke data seeded at: ${dataDir}\n`);
  process.stdout.write(
    `Use with: src-tauri/target/release/bundle/macos/job-sync.app/Contents/MacOS/job-sync --data-dir ${dataDir}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
