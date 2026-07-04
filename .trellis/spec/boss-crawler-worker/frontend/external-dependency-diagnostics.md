# External Dependency Diagnostics

## Scenario: Settings Dependency Readiness Panel

### 1. Scope / Trigger

- Trigger: adding or changing the Settings page dependency diagnostics IPC contract.
- Applies when the UI needs to report Boss session readiness, model service reachability, or Telegram notification configuration.
- The diagnostics panel is local-first evidence gathering. It must not trigger job apply, chat, greeting send, crawl, or Telegram message send side effects.

### 2. Signatures

- Rust command:
  `diagnose_external_dependencies(app, api_key, base_url) -> Result<ExternalDependencyDiagnostics, String>`
- Frontend invoke:
  `invoke<ExternalDependencyDiagnostics>("diagnose_external_dependencies", { apiKey, baseUrl })`
- Registration:
  `commands::settings::diagnose_external_dependencies` must be present in the Tauri invoke handler.

### 3. Contracts

- Request fields:
  - `apiKey: string | null`: optional unsaved key from the Settings form; pass `null` when blank.
  - `baseUrl: string | null`: optional unsaved Base URL from the Settings form; pass `null` when blank.
- Response root:
  - `checked_at: string`
  - `boss_session: BossSessionDiagnostic`
  - `model_service: ModelServiceDiagnostic`
  - `telegram: TelegramDiagnostic`
- `BossSessionDiagnostic` may expose only booleans and a summary message:
  `ready`, `cookies_present`, `cookies_valid_json`, `local_storage_present`, `local_storage_valid_json`.
- `ModelServiceDiagnostic` may expose provider, effective Base URL, model count, and up to a small model sample. It must never expose API keys.
- `TelegramDiagnostic` may expose only `has_bot_token`, `bot_token_valid`, `has_chat_id`, and `chat_id_valid`. It must never expose the bot token or chat id.
- Copyable diagnostic summaries may be generated on the Settings page after diagnostics have run, but they must be derived from the redacted diagnostics object and must not read raw form state such as `apiKey`, `baseUrl`, `telegramBotToken`, or `telegramChatId`.
- The copied summary should describe local evidence and manual boundaries only. It must not include raw API keys, bot tokens, chat ids, Cookie contents, LocalStorage contents, or trigger any external side effect.

### 4. Validation & Error Matrix

| Condition | Diagnostic status | Message behavior |
| --- | --- | --- |
| Both Boss files exist and parse as JSON | `ok` | Say the session can be reused without showing file contents. |
| Either Boss file is missing or invalid JSON | `warning` | Say login state is missing/incomplete without showing contents. |
| Model list request succeeds | `ok` | Show count and small sample only. |
| Model list request fails | `error` | Surface the returned error message; do not fabricate success. |
| Telegram bot token missing | `warning` | Say no bot token is saved. |
| Telegram bot token saved but malformed | `warning` | Say the token format should be checked. |
| Telegram chat id missing | `warning` | Say no chat id is saved. |
| Telegram chat id saved but malformed | `warning` | Say the chat id format should be checked. |
| Telegram token and chat id look valid | `ok` | Say they are saved and manual send remains a separate action. |

### 5. Good/Base/Bad Cases

- Good: saved Ollama provider with no API key can still diagnose model list by using the shared Ollama dummy key path.
- Base: no Boss login and no Telegram configuration shows warnings, not a page-level failure.
- Bad: network failure to model service returns `error` and keeps the button retryable.
- Bad: diagnostics call sends a Telegram message or exposes the bot token/chat id in the response or copied summary.

### 6. Tests Required

- Rust unit tests for Boss file presence/parseability and Telegram redaction.
- Contract test asserting command registration, manual Settings invoke, redacted Telegram copy, and no Telegram send command from Settings diagnostics.
- Frontend build/type-check to ensure the response shape matches the Vue template.
- Browser smoke for Settings page desktop and mobile width when the UI changes.

### 7. Wrong vs Correct

#### Wrong

```typescript
await invoke("send_daily_job_intelligence_telegram_notification");
diagnostics.value = {
  telegram: {
    bot_token: savedTelegramBotToken,
    chat_id: savedTelegramChatId,
  },
};
```

This sends or exposes external secrets from a diagnostics surface.

#### Correct

```typescript
diagnostics.value = await invoke<ExternalDependencyDiagnostics>(
  "diagnose_external_dependencies",
  {
    apiKey: apiKey.value.trim() || null,
    baseUrl: baseUrl.value.trim() || null,
  },
);
```

The diagnostics command returns status-only evidence and keeps external side effects behind separate manual actions.
