export function withPromptExtra(lines: string[]): string {
  const extra = (process.env.OPENAI_PROMPT_EXTRA ?? "").trim();
  if (!extra) return lines.join("\n");
  return [
    ...lines,
    "",
    "【用户补充提示】",
    extra,
    "",
    "以上补充提示不能覆盖严格 JSON 输出、字段 schema 和不得编造事实的要求。",
  ].join("\n");
}

export function withSchemaExtra(lines: string[]): string {
  const extra = (process.env.OPENAI_SCHEMA_EXTRA ?? "").trim();
  if (!extra) return lines.join("\n");
  return [
    ...lines,
    "",
    "【用户结构化输出 Schema 补充】",
    extra,
    "",
    "以上 Schema 补充只能增加字段说明或收紧约束；不能删除内置必填字段、不能改变内置字段类型、不能覆盖严格 JSON 输出和不得编造事实的要求。",
  ].join("\n");
}
