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
