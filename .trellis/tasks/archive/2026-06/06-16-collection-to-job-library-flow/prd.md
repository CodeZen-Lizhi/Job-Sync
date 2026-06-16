# 收口自动采集到职位库流程

## Problem Statement

当前从自动采集到职位库的流程在产品心智上偏复杂。用户需要同时理解采集意图、平台采集设置、筛选画像、关键词规则、候选队列和职位库展示，导致“点了自动采集以后，最后为什么留下这些岗位”不够直观。

用户认可系统应该尽量保留采集到的岗位事实：自动采集拿到的岗位应进入本地 Job library，再由 Filter profile 计算是否进入可行动的 Candidate queue。问题不在底层原则，而在页面表达和流程收口：

- 采集配置页把“我要找什么岗位”和“采后如何判断岗位是否值得看”混在一起。
- 筛选画像仍以“必须包含关键词 / 必须排除关键词 / 偏好关键词”为主要表达，容易让用户误以为筛选只是标题或列表关键词匹配。
- 实际筛选应更多基于 JD、帖子正文、岗位详情和来源事实，而不是只看关键词。
- 职位库默认视图应展示整理后的结果，而不是让用户面对一个混杂的原始列表。
- 被过滤岗位不应丢失，但应清楚说明过滤原因，并默认从可行动列表中移开。

## Solution

将“自动采集到职位库”重塑为一个更简单的用户流程：

1. 用户在采集配置中表达本次 Collection intent：想从哪些 Collectable platforms 搜什么范围。
2. 系统将 Collection intent 映射为 Platform collection settings，用于各平台尽量扩大采集样本。
3. 自动采集得到的岗位进入 Job library，保留来源、原始事实、JD/帖子正文、去重键、采集批次和更新时间。
4. 系统用默认 Filter profile 对 Job library 中的新岗位或更新岗位做采后判断。
5. 职位库默认展示 Candidate queue，也就是“推荐查看 / 待确认 / 已处理”等可行动结果。
6. 已过滤岗位仍保留在 Job library 的“已过滤”视图中，显示规则命中、正文证据和可复算状态。
7. 采集结束后展示批次总结，让用户知道新增、更新、推荐、待确认、过滤、重复分别是多少，以及主要过滤原因。

本 PRD 只覆盖自动采集、采集配置、采后筛选和职位库展示。职位分析、AI 报告、简历优化和投递准备不纳入本次改造。

## User Stories

1. As a job seeker, I want to click automatic collection and later see a clean list of jobs worth reviewing, so that I do not need to understand internal pipeline details.
2. As a job seeker, I want collected jobs to be preserved in the job library even when they are filtered out, so that I can change rules and recover them later.
3. As a job seeker, I want the default job library view to show actionable jobs first, so that I can start reviewing immediately.
4. As a job seeker, I want filtered jobs to be available in a separate view, so that I can audit whether the rules are too strict.
5. As a job seeker, I want each filtered job to show the concrete reason it was filtered, so that I can trust or adjust the rule.
6. As a job seeker, I want filtering to consider JD text and post content, so that roles are judged by actual responsibilities rather than only title keywords.
7. As a job seeker, I want collection keywords to mean search expansion, so that broad platform search does not become an accidental hard filter.
8. As a job seeker, I want must-have and must-not-have rules to be expressed as post-collection rules, so that they can inspect full job detail when available.
9. As a job seeker, I want “outsourcing”, “onsite”, “training”, “sales-like”, and similar exclusions to read the job content, so that noisy job posts are handled more accurately.
10. As a job seeker, I want jobs with insufficient detail to land in a “待确认” bucket, so that potentially valuable jobs are not silently discarded.
11. As a job seeker, I want the system to explain whether a decision came from title/list data or JD/detail data, so that I understand confidence.
12. As a job seeker, I want duplicate jobs to be merged or updated instead of duplicated in the list, so that the job library stays clean.
13. As a job seeker, I want a collection batch summary after automatic collection finishes, so that I know what changed.
14. As a job seeker, I want the batch summary to include newly added jobs, updated jobs, filtered jobs, duplicate jobs, and recommended jobs, so that I can judge collection quality.
15. As a job seeker, I want the batch summary to list top filtering reasons, so that I can quickly spot overly broad or overly strict rules.
16. As a job seeker, I want the job library to default to recent unprocessed candidates, so that old or already handled jobs do not bury new results.
17. As a job seeker, I want separate tabs or segments for 推荐查看, 待确认, 已过滤, 已处理, and 全部入库, so that each view has a clear purpose.
18. As a job seeker, I want the “全部入库” view to remain available, so that I can inspect source facts and history.
19. As a job seeker, I want filter profile naming to emphasize “采后判断规则” rather than “关键词画像”, so that the UI matches how decisions are actually made.
20. As a job seeker, I want platform settings to stay platform-specific, so that Boss, V2EX, and future platforms can collect in their native ways.
21. As a job seeker, I want platform collection settings to be derived from my collection intent only when I explicitly sync them, so that manual platform tuning is not overwritten unexpectedly.
22. As a job seeker, I want reserved platforms to stay out of runnable collection choices, so that the collection page only shows sources that can actually run.
23. As a job seeker, I want candidate source rules to stay separate from collection source selection, so that enabling a platform does not automatically mean its jobs are recommended.
24. As a job seeker, I want manually imported or feed-sourced jobs to enter the same job library and filter pipeline, so that all sources use one review workflow.
25. As a job seeker, I want source platform and collection method filters in the job library, so that I can inspect where useful jobs are coming from.
26. As a job seeker, I want the UI to explain that filtered jobs are not deleted, so that I can safely tune rules.
27. As a job seeker, I want a single clear path from collection completion to job review, so that I am not forced to jump between pages to understand results.
28. As a job seeker, I want direct text search to remain available inside the job library, so that I can manually find specific roles or companies.
29. As a job seeker, I want hard filters and preference scoring to be visually separate, so that “not eligible” and “less preferred” are not confused.
30. As a job seeker, I want the system to avoid presenting AI analysis and resume optimization before I have chosen jobs to care about, so that early workflow stays focused.

## Implementation Decisions

- Preserve the current architectural principle: collected jobs are written to the unified job model in the Job library first, then the default Filter profile derives eligibility, explanations, and candidate queue membership.
- Do not implement a “filter before persistence” pipeline. Pre-detail filtering may remain an optimization for platform-specific crawling, but it must not be the product truth and must not make filtered jobs invisible.
- Rename and reorganize UI concepts so users see one workflow: Collection intent for broad search, Post-collection rules for judging results, and Job library result views for action.
- Keep Collection intent as an expansion-oriented input. Multi-value search fields broaden the crawl; they are not required matches.
- Convert the current keyword-heavy Filter profile UI into a rule editor that emphasizes semantic rule groups:
  - deal breakers: outsourcing, training, onsite/驻场, sales-like, low salary, wrong city, wrong experience, wrong source, stale communication state
  - must-have signals: required direction, required tech, required work mode, minimum salary, acceptable source
  - preferences: nice-to-have direction, tech, company traits, work mode
  - uncertainty handling: unknown salary, unknown experience, missing JD, weak evidence
- The rule editor should make clear which rules inspect title/list fields and which inspect JD/detail/post content.
- Use existing `jd_text`, raw detail payloads, and normalized job fields as the primary evidence base for post-collection rules.
- Consider extracting a deep module for post-collection rule evaluation with a stable interface: input is a unified job record plus optional detail text and filter profile; output is eligibility, bucket, reason list, evidence snippets, and confidence/source of evidence.
- The existing Rust filter profile evaluator is the likely home for canonical post-collection decisions because it already writes `job_filter_result` and serves job library queries.
- The Boss worker list-level profile filter may remain as a collection-time optimization, but it should not own canonical eligibility. It should either save enough list-level evidence or defer final judgment to the canonical post-collection evaluator after persistence.
- Introduce or formalize result buckets for the job library:
  - 推荐查看: eligible and unprocessed jobs with enough evidence
  - 待确认: potentially relevant jobs with insufficient detail or ambiguous evidence
  - 已过滤: ineligible jobs with reasons
  - 已处理: reviewed, ignored, ready-to-apply, applied, or terminal communication states
  - 全部入库: complete historical/library view
- Job library default view should be 推荐查看 or a combined “可行动” view, not a raw all-jobs view.
- Job cards should surface short explanations:
  - why this job is recommended
  - why it needs confirmation
  - why it was filtered
  - whether the reason came from JD/detail content, list fields, blacklist, communication status, or manual review state
- Add a collection batch summary concept. At minimum the UI should show counts for captured, inserted, updated, duplicate/merged, recommended, pending confirmation, filtered, and failed/error jobs.
- If existing schema does not track batch identity or per-run aggregation clearly enough, add a minimal collection batch model rather than deriving all summary data from logs.
- Keep source facts and deduplication platform-neutral. Boss, V2EX, manual imports, and future platforms should all use the unified job model and the same post-collection rule pipeline.
- Do not move AI resume matching, AI group analysis, resume workspace, greeting generation, or application readiness into this early flow. These remain downstream actions after a user selects jobs worth pursuing.
- The implementation should be incremental: first clarify labels and default views, then strengthen post-collection rule results, then add batch summary if needed.

## Testing Decisions

- Tests should assert external behavior: what jobs are persisted, how they are bucketed, what reasons are shown, and how views count/display results. Avoid tests that only lock internal helper names or UI implementation details.
- Add or update Rust tests around canonical post-collection filter evaluation:
  - JD/detail text can satisfy required direction or required tech rules.
  - JD/detail text can trigger exclusion rules such as outsourcing, onsite, training, or sales-like work.
  - Missing detail can produce 待确认 rather than a hard false negative when appropriate.
  - Changing the default Filter profile recomputes existing Job library records.
  - Blacklist, communication status, and manual review status continue to affect eligibility.
- Add or update Rust query tests around job library buckets:
  - 推荐查看 excludes filtered and already terminal jobs.
  - 已过滤 includes jobs with `eligible = false` and exposes reason JSON.
  - 全部入库 includes both eligible and filtered jobs.
  - source platform and collection method filters still work.
- Add or update TypeScript/Vue tests or contract tests for UI-facing behavior where the project already has precedent:
  - collection configuration no longer presents keyword rules as the primary “user profile” mental model.
  - job library default view loads actionable jobs first.
  - filtered jobs show concise reason summaries.
  - batch summary counters are rendered from structured data rather than parsed logs.
- Add worker tests only for collection-time behavior that remains in the worker:
  - worker list-level filtering does not become the only source of truth.
  - filtered list items still emit enough evidence for persistence or later recomputation when the optimization is enabled.
- Reuse existing patterns in the repository: Rust command/query tests for SQLite behavior, worker tests for crawl/filter contracts, and frontend contract/page tests for visible behavior.

## Out of Scope

- AI职位匹配分析。
- AI综合报告和报告查看器。
- 简历工作区、简历诊断、模块改写、最终简历和 PDF 导出。
- 自动投递、自动开聊或外部平台发送动作。
- 新增非现有自动采集平台的完整适配。
- 大规模重写底层统一职位模型。
- 将所有规则升级为 LLM 判断。正文/JD 筛选可以先用确定性规则和结构化解释完成，AI 只作为未来增强。

## Further Notes

- 本需求继续使用项目术语：Collection intent、Platform collection settings、Filter profile、Candidate queue、Job library、Allowed candidate sources、Collectable platform。
- 产品原则是“保留事实，派生候选”：Job library 保存采集到的事实，Candidate queue 是当前 Filter profile 下的行动视图。
- 用户明确倾向于第二种流程：采集到的岗位都入库，然后根据筛选画像进行采后筛选。
- 用户不认可将筛选主要表达为关键词筛选，尤其是对 JD 或帖子正文的判断。后续实现应把关键词降级为一种简单规则，而不是整个画像的中心。
- 这是一项复杂产品流程改造。进入实现前应补充 `design.md` 和 `implement.md`，并把采集配置、筛选规则、职位库查询/展示拆成可独立验收的子任务或阶段。
