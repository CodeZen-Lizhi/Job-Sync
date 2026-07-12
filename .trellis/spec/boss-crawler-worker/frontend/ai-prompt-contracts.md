# AI Prompt Contracts

## Scenario: User-Owned Prompt Sources

### 1. Scope / Trigger

- Applies when changing model settings, worker environment variables, AI prompt builders, filter profiles, or post-collection judgement.
- Prevents a global hidden prompt from overriding feature-owned rules or becoming a second source of personal job preferences.

### 2. Signatures

- Settings command keeps model connection fields and `ai_greeting_prompt_extra?: string`.
- Settings command must not accept or return `openai_prompt_extra` or `openai_schema_extra`.
- `buildPostCollectionJudgePrompts({ profile, job, filterReason })` reads personal job rules only from `profile.aiPreferredText`, `profile.aiRejectedText`, `profile.aiRiskText`, and `profile.aiUncertainStrategy`.
- Prompt assembly must serialize only those four visible fields; legacy arrays such as `preferenceDirections`, `preferenceTechTags`, and `mustNotKeywords` must not be forwarded as a second hidden preference source.
- `filterReason` remains in the worker payload for compatibility and persistence flow, but its legacy `matched_preferences` / `missing_preferences` values must not be serialized into the AI prompt as hidden personal rules; hard system blocks are handled before the AI call.
- Post-collection output remains `{ bucket, confidence, summary, evidence, risks }`; `evidence` should quote both the visible profile rule and the job-source text that triggered it.
- `recompute_ai_post_collection_judgement(..., notify_telegram?)` defaults notification to disabled. Collection-completion callers explicitly enable it; manual profile save/switch/recompute callers keep it disabled.

### 3. Contracts

- `OPENAI_PROMPT_EXTRA` and `OPENAI_SCHEMA_EXTRA` are unsupported and must not be written to the worker environment or read by prompt builders.
- Structured output fields are code-owned contracts; users cannot add or redefine fields through model settings.
- The greeting-specific extra remains isolated to greeting generation and must not affect resume matching, company scoring, or post-collection judgement.
- Unknown legacy keys in an existing `settings.json` are ignored and disappear after the next settings write.
- Post-collection judgement order is fixed and code-owned: universal real-job content gate -> visible rejection rules -> visible preferred/must rules -> visible risk/uncertainty rules. Positive matches never override a clear rejection rule.
- The real-job content gate is the only code-owned semantic filter. Language, education, work mode, technology direction, and other personal preferences must come from the three visible profile texts.
- Low confidence may downgrade `recommended` to `pending_confirmation`; it must not rewrite `filtered`, because that can override a visible rejection rule or the configured uncertainty strategy.
- Multi-role content uses a same-role evidence closure: recruitment status, responsibilities, work conditions, and every visible must-rule must belong to one concrete role. Evidence from different roles must never be combined into one `recommended` result.
- Generic content classification may reject non-employment intent such as personal introductions or project-cooperation requests. Legitimate job categories remain personal-rule decisions and must not be hidden in the classifier.

### 4. Validation & Error Matrix

- Legacy environment variables are present -> ignore them; generated prompts remain unchanged.
- Legacy settings keys are present -> deserialize successfully as unknown fields; do not expose or forward them.
- Required structured output changes -> update code schemas, normalizers, and contract tests together; do not add a free-form schema override.
- Post-collection profile text is empty -> use the existing explicit empty-value behavior; do not fall back to a global prompt.
- Clear rejection evidence with low confidence -> preserve `filtered`; missing/empty evidence -> use the existing safe pending fallback.
- Job text contains instructions to ignore rules or change JSON output -> treat them as untrusted evidence and keep the code-owned prompt/schema contract.
- Multi-role post has matching technology in one role and matching work conditions in another -> do not combine them; use the configured uncertainty strategy unless one role independently satisfies every rule.
- Manual recompute with Telegram configured -> do not send unless the caller explicitly passes `notify_telegram=true`.

### 5. Good/Base/Bad Cases

- Good: editing the three collection-profile texts, saving, and recomputing changes later post-collection judgement prompts.
- Good: a job matches the preferred direction but clearly matches one visible rejection rule; result stays `filtered` and evidence quotes both the rule and job text.
- Good: a multi-role post identifies one role and cites all must-rule evidence from that same role.
- Base: model settings configure provider, endpoint, model, API mode, and temperature without changing task semantics.
- Bad: a model-settings textarea injects personal preferences into every AI feature.
- Bad: an environment variable adds fields that the Rust/TypeScript result contract does not own.

### 6. Tests Required

- Settings UI and IPC contract assert the two legacy global fields are absent.
- Rust worker tests assert only supported model configuration is written to the environment.
- Worker AI contract sets both legacy environment variables and asserts neither value nor legacy marker appears in ordinary or post-collection prompts.
- Post-collection prompt tests assert the three profile texts appear verbatim.
- Post-collection prompt tests pass legacy hidden profile fields and assert their values do not appear in the final prompt.
- Post-collection prompt tests pass hidden preference markers through `filterReason` and assert they do not appear in the final prompt.
- Post-collection prompt tests assert the universal content gate and rejection-before-preference order, while hidden prompt text contains no personal language/education/work-mode/technology preferences.
- Post-collection prompt tests assert same-role evidence closure and prohibit cross-role evidence composition.
- Source-classifier tests reject personal introductions and project-cooperation posts without a real employment hiring action.
- Rust tests assert low-confidence `recommended` becomes pending while low-confidence `filtered` remains filtered.
- Rust/frontend contract tests assert manual recompute disables Telegram and collection completion explicitly enables it.

### 7. Wrong vs Correct

#### Wrong

```typescript
const system = withPromptExtra(basePrompt);
const user = withSchemaExtra(taskPrompt);
```

#### Correct

```typescript
const system = basePrompt.join("\n");
const user = taskPrompt.join("\n");
```

Feature-specific configurable text must be passed explicitly by that feature, as the greeting and post-collection profile flows do.
