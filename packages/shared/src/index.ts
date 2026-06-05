import { z } from "zod";

export const ProjectConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  branch: z.string().optional(),
  description: z.string().optional(),
  aliases: z.record(z.string(), z.string()).optional()
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const LogicFactTypeSchema = z.enum([
  "conditional_render",
  "jsx_attribute",
  "api_call",
  "state",
  "context",
  "mobx",
  "event_handler"
]);

export type LogicFactType = z.infer<typeof LogicFactTypeSchema>;

export type EvidenceRef = {
  filePath: string;
  line: number;
  snippet: string;
};

export type LogicFact = {
  id: string;
  projectId: string;
  filePath: string;
  line: number;
  componentName?: string;
  type: LogicFactType;
  targetText?: string;
  expression?: string;
  summary: string;
  dependencies: string[];
  evidence: EvidenceRef[];
  confidence: "high" | "medium" | "low";
};

export type IndexedFile = {
  projectId: string;
  filePath: string;
  imports: string[];
  exports: string[];
  components: string[];
  codePreview: string;
};

export type ProjectIndex = {
  project: ProjectConfig;
  generatedAt: string;
  files: IndexedFile[];
  facts: LogicFact[];
};

export type AskRequest = {
  projectId: string;
  question: string;
};

export type AnswerSection = {
  title: string;
  items: string[];
};

export type AnswerTrace = {
  mode: "local" | "gateway";
  model?: string;
  totalFacts: number;
  matchedFacts: number;
  usedFacts: number;
  queryTerms: string[];
  /** AI 的完整思考过程（流式累积后的全文） */
  reasoning?: string;
  /** 本次问答调用总耗时（毫秒） */
  durationMs?: number;
  /** 喂给模型的证据/提示大致字符数，用于展示调用规模 */
  promptChars?: number;
};

export type LogicAnswer = {
  question: string;
  conclusion: string;
  confidence: "high" | "medium" | "low";
  sections: AnswerSection[];
  relatedFiles: string[];
  evidence: EvidenceRef[];
  usedFacts: LogicFact[];
  mode: "local" | "gateway";
  trace?: AnswerTrace;
  previewHtml?: string;
};

/**
 * /api/ask 流式响应的事件协议（按 NDJSON 逐行传输）。
 * - trace：开始时下发的调用详情元信息（模型、查询词、命中事实数等）
 * - reasoning：AI 思考过程增量，前端逐字追加
 * - answer：思考结束后的完整答案（结论、预览等）
 * - error：异常信息
 */
export type AskStreamEvent =
  | { type: "trace"; trace: AnswerTrace; facts: LogicFact[]; evidence: EvidenceRef[] }
  | { type: "reasoning"; delta: string }
  | { type: "answer"; answer: LogicAnswer }
  | { type: "error"; message: string };
