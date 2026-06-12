import { z } from "zod";

/** 项目来源：env=环境变量配置（只读）；stored=UI 添加并持久化（可删）；builtin=内置 demo */
export const ProjectSourceSchema = z.enum(["env", "stored", "builtin"]);

export type ProjectSource = z.infer<typeof ProjectSourceSchema>;

export const ProjectConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  branch: z.string().optional(),
  description: z.string().optional(),
  aliases: z.record(z.string(), z.string()).optional(),
  gitUrl: z.string().optional(),
  source: ProjectSourceSchema.optional()
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
  /** JSX 事件绑定事实的事件名（如 onClick），作为结构化标记供交互链路识别 */
  eventName?: string;
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

/** 交互链路中一步的代码引用 */
export type FlowRef = {
  filePath: string;
  line: number;
  /** 人话描述，如接口 URL、state 名、受影响的展示文案 */
  text: string;
};

/**
 * 交互链路：用户操作 → handler → 接口调用 → 状态变化 → 页面变化。
 * 由静态分析在同文件事实间串联合成，用于回答"点击 X 之后会发生什么"类问题。
 */
export type InteractionFlow = {
  id: string;
  projectId: string;
  filePath: string;
  componentName?: string;
  /** 触发控件文案（按钮、链接等） */
  trigger: string;
  /** 触发绑定所在行号 */
  triggerLine: number;
  /** 事件名，如 onClick / onSubmit */
  eventName: string;
  /** 处理函数名（可能为内联表达式而缺失） */
  handlerName?: string;
  handlerLine?: number;
  /** handler 触发的接口调用 */
  apiCalls: FlowRef[];
  /** handler 改变的组件 state */
  stateChanges: FlowRef[];
  /** 受这些 state 影响的展示/可操作逻辑 */
  affectedRenders: FlowRef[];
  confidence: "high" | "medium" | "low";
};

export type ProjectIndex = {
  project: ProjectConfig;
  generatedAt: string;
  files: IndexedFile[];
  facts: LogicFact[];
  /** 交互链路（旧索引文件无此字段，读取时按 undefined 兼容） */
  flows?: InteractionFlow[];
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
};

/**
 * /api/ask 流式响应的事件协议（按 NDJSON 逐行传输）。
 * - trace：开始时下发的调用详情元信息（模型、查询词、命中事实数等）
 * - reasoning：AI 思考过程增量，前端逐字追加
 * - answer：思考结束后的完整答案（结论等）
 * - error：异常信息
 */
export type AskStreamEvent =
  | { type: "trace"; trace: AnswerTrace }
  | { type: "reasoning"; delta: string }
  | { type: "answer"; answer: LogicAnswer }
  | { type: "error"; message: string };

/**
 * 页面预览的 Sandpack 打包产物：把入口组件及其本地依赖源码、npm 依赖、
 * 自动生成的挂载入口（含 Provider/接口 mock）打包，交给前端在浏览器内真实渲染。
 */
export type PreviewBundle = {
  /** 入口组件文件（相对项目根，如 src/pages/order/List.jsx） */
  entry: string;
  /** 入口组件名（default export 组件） */
  entryComponent: string;
  /** Sandpack 文件表：路径 -> 源码，含自动生成的 /index.js 挂载入口 */
  files: Record<string, string>;
  /** npm 依赖表：包名 -> 版本（不含 react/react-dom，由模板提供） */
  dependencies: Record<string, string>;
  /** 渲染模式：gateway 表示挂载入口由 AI 生成，local 为通用模板兜底 */
  mountMode: "local" | "gateway";
};
