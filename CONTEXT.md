# Job Sync Context

Job Sync helps a job seeker collect job postings from multiple platforms, preserve source facts, and narrow them into actionable candidates.

## Language

**Unified job model**:
A platform-neutral job record that preserves source platform, source URL, raw source facts, and normalized fields used by filtering, review, AI analysis, and application preparation.
_Avoid_: Boss job model, raw platform record

**Collection intent**:
A pre-collection description of what the user wants to search for across platforms. It may be translated into different platform-specific collection settings before collection starts.
_Avoid_: Filter profile, Boss search conditions

**Collection expansion**:
The default interpretation of multi-value collection intent fields: collect broadly across the selected values to avoid missing jobs. Collection expansion does not mean every collected job must satisfy every selected value.
_Avoid_: Required match, hard constraint

**Platform collection settings**:
The search and authentication settings for one source platform. These settings are platform-specific and may be derived from a collection intent, then adjusted independently.
_Avoid_: Global search settings

**Collectable platform**:
An enabled platform whose automatic collection flow is implemented and may participate in collection source selection.
_Avoid_: Reserved platform

**Reserved platform**:
A platform known to the product but not yet available for automatic collection. Reserved platforms may appear in settings as roadmap or manual-import capabilities, but should not appear as runnable collection choices.
_Avoid_: Collectable platform

**Platform enablement**:
A settings-level capability switch that makes a platform available for configuration, login, and collection. Enablement does not mean the platform must participate in every collection run.
_Avoid_: Default collection source

**Platform login state**:
The authentication readiness of one source platform. Login state is platform-specific and should not be represented as a single global collection login state.
_Avoid_: Global login state

**Collection source selection**:
The task-level choice of which enabled platforms participate in one collection run.
_Avoid_: Platform enablement, filter source rule

**Allowed candidate sources**:
A filter profile rule that decides which source platforms may appear in candidate queues after jobs have already been collected into the job library.
_Avoid_: Collection source selection

**Collection intent sync**:
An explicit user action that proposes platform collection settings from the current collection intent. It should not silently overwrite platform settings that the user has manually adjusted.
_Avoid_: Auto-apply, live binding

**Best-effort platform mapping**:
The rule that a platform adapter maps as much of the collection intent as the platform can support, while exposing unmapped fields instead of pretending they were applied.
_Avoid_: Lossless mapping, silent fallback

**Filter profile**:
A post-collection preference and constraint profile applied to jobs in the unified job model. It decides candidate eligibility, ranking, and review queues, but does not define platform search parameters.
_Avoid_: Collection intent, platform search settings

**Candidate queue**:
A narrowed set of collected jobs that passed the current filter profile and is ready for human review, ranking, or application preparation.
_Avoid_: Job library

**Job library**:
The persistent collection of jobs gathered or imported from platforms, including jobs that do not pass the current filter profile.
_Avoid_: Candidate queue

**Resume library**:
The dedicated page for creating, editing, deleting, and selecting resumes.
_Avoid_: Resume workspace

**Default resume**:
The fallback resume used when a job has no linked resume.
_Avoid_: Base resume, fallback profile

**Job resume link**:
A job's single primary resume association used when resume-aware actions need a resume for that job.
_Avoid_: Multi-resume job link, resume workspace link

## Example Dialogue

Product: "I want to collect backend jobs in Shanghai with Go and Kubernetes."

Engineer: "That is the collection intent. We can map it to Boss collection settings first, then later add mappings for other platforms."

Product: "I also want to reject outsourcing and low salary roles."

Engineer: "That belongs in the filter profile. Those jobs may still enter the job library for traceability, but they should not enter the candidate queue."

Product: "If the collection intent includes Go and Kubernetes, must every collected job contain both?"

Engineer: "No. Collection intent uses collection expansion by default. Put required matches in the filter profile."

Product: "When I change the collection intent, should platform settings change immediately?"

Engineer: "No. Use collection intent sync to propose platform settings, then let the user review and save them."

Product: "What if Boss cannot represent every selected collection intent value?"

Engineer: "Use best-effort platform mapping. Apply what Boss supports, show what was not mapped, and rely on the filter profile for post-collection precision."

Product: "If Liepin is enabled, does every collection run use Liepin?"

Engineer: "No. Platform enablement only makes Liepin available. Collection source selection decides whether this run uses Liepin."

Product: "When the collection page says source platform, what does that mean?"

Engineer: "On the collection page it means collection source selection. In a filter profile, call the post-collection rule allowed candidate sources instead."

Product: "Does the collection page have one login state?"

Engineer: "No. Each platform has its own login state. The collection page may show a platform status summary, but it should not imply global login."

Product: "Should the collection page show Liepin settings before Liepin collection is implemented?"

Engineer: "No. Show only collectable platforms on the collection page. Keep reserved platforms in settings until they can actually run."
