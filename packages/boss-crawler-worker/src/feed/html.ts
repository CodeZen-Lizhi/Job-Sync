export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 10)));
}

export function stripCdata(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("<![CDATA[") && trimmed.endsWith("]]>")) {
    return trimmed.slice("<![CDATA[".length, -"]]>".length);
  }
  return trimmed;
}

export function htmlToText(
  html: string,
  options: {
    stripCdata?: boolean;
    stripScriptStyle?: boolean;
    sectionBreaks?: boolean;
    extraBlockTags?: string[];
  } = {},
): string {
  const baseBlockTags = options.sectionBreaks
    ? ["p", "div", "li", "h[1-6]", "tr", "section", "article"]
    : ["p", "div", "li", "h[1-6]", "tr"];
  const blockTags = [...baseBlockTags, ...(options.extraBlockTags ?? [])].join("|");
  let text = options.stripCdata ? stripCdata(html) : html;
  text = decodeHtmlEntities(text);
  if (options.stripScriptStyle) {
    text = text
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  }
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(new RegExp(`</(${blockTags})>`, "gi"), "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
