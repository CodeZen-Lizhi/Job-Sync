import type { z as zType } from "zod";

import type {
  AiAnalyzeGroupPayloadSchema,
  AiAnalyzePayloadSchema,
  AiCompanyScoreBatchPayloadSchema,
  AiGreetingPayloadSchema,
  AiPostCollectionJudgePayloadSchema,
  EventOut,
} from "../../protocol.js";

export type AiAnalyzePayload = zType.infer<typeof AiAnalyzePayloadSchema>;
export type AiAnalyzeGroupPayload = zType.infer<typeof AiAnalyzeGroupPayloadSchema>;
export type AiGreetingPayload = zType.infer<typeof AiGreetingPayloadSchema>;
export type AiCompanyScoreBatchPayload = zType.infer<typeof AiCompanyScoreBatchPayloadSchema>;
export type AiPostCollectionJudgePayload = zType.infer<typeof AiPostCollectionJudgePayloadSchema>;

export type ModeContext = {
  emit: (event: EventOut) => void;
  signal: AbortSignal;
};
