import type { LogicFact, ProjectIndex } from "@frontend-logic/shared";

/**
 * 当索引里实在抽不出足够线索时，用这组通用问题补足，保证 UI 不为空。
 * 它们仍贴合"前端逻辑问答"主题，适用于任意 React 项目。
 */
const GENERIC_FALLBACK = [
  "这个项目里有哪些按钮的显示是有条件的？",
  "页面数据是通过哪些接口加载的？",
  "哪些内容会根据登录用户或权限变化？"
];

const CONFIDENCE_ORDER: Record<LogicFact["confidence"], number> = {
  high: 0,
  medium: 1,
  low: 2
};

/**
 * 基于项目代码索引生成"跟项目相关"的推荐问题。
 * 优先级：可见性条件 → 可用性属性 → 接口调用 → 权限/上下文 → 交互入口，最后用通用问题补足。
 */
export function suggestQuestions(index: ProjectIndex, limit = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (question: string | undefined | null) => {
    if (!question || out.length >= limit) return;
    const trimmed = question.replace(/\s+/g, " ").trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  const facts = index.facts ?? [];

  // 1) 可见性 / 条件渲染：优先有可读文案（如按钮、字段名）的目标
  const visibility = facts
    .filter((fact) => fact.type === "conditional_render" && readableLabel(fact.targetText))
    .sort(byConfidence);
  for (const fact of visibility) {
    push(`「${readableLabel(fact.targetText)}」什么时候显示？`);
    if (out.length >= limit) break;
  }

  // 2) 可用性：disabled / hidden / readOnly 等属性控制的元素
  const toggles = facts
    .filter((fact) => fact.type === "jsx_attribute" && readableLabel(fact.targetText))
    .sort(byConfidence);
  for (const fact of toggles) {
    push(`「${readableLabel(fact.targetText)}」在什么情况下不可用？`);
    if (out.length >= limit) break;
  }

  // 3) 接口调用：按组件 / 文件聚合
  for (const scope of collectApiScopes(facts)) {
    push(`${scope} 调用了哪些接口？`);
    if (out.length >= limit) break;
  }

  // 4) 权限 / 上下文
  if (facts.some((fact) => fact.type === "context" || fact.type === "mobx")) {
    push("哪些内容会根据登录用户或权限变化？");
  }

  // 5) 交互入口（允许可读的英文 handler 名）
  const handlers = facts.filter(
    (fact) => fact.type === "event_handler" && readableLabel(fact.targetText, true)
  );
  for (const fact of handlers) {
    push(`${readableLabel(fact.targetText, true)} 处理了哪些逻辑？`);
    if (out.length >= limit) break;
  }

  // 6) 用通用问题补足到 limit
  for (const generic of GENERIC_FALLBACK) {
    if (out.length >= limit) break;
    push(generic);
  }

  return out.slice(0, limit);
}

function byConfidence(a: LogicFact, b: LogicFact): number {
  return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
}

/**
 * 清洗并校验目标文案是否适合作为推荐语标签。
 * 默认只接受含中文的短文案；allowAscii 时额外接受合理的英文标识符（如 handler 名）。
 */
function readableLabel(target: string | undefined, allowAscii = false): string | undefined {
  if (!target) return undefined;
  // 三元表达式两侧用 " / " 连接，取第一段；去掉 <Xxx> 组件占位
  let label = (target.split(" / ")[0] ?? target).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!label) return undefined;
  if (label.length > 14) label = label.slice(0, 14);

  if (/[一-鿿]/.test(label)) return label;
  if (allowAscii && /^[A-Za-z][A-Za-z0-9_]{2,}$/.test(label)) return label;
  return undefined;
}

function collectApiScopes(facts: LogicFact[]): string[] {
  const scopes: string[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    if (fact.type !== "api_call") continue;
    const scope = fact.componentName ?? baseName(fact.filePath);
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    scopes.push(scope);
  }
  return scopes;
}

function baseName(filePath: string): string {
  const file = filePath.split("/").pop() ?? filePath;
  return file.replace(/\.(jsx?|tsx?)$/, "");
}
