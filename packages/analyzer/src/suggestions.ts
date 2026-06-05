import type { LogicFact, ProjectIndex } from "@frontend-logic/shared";

/**
 * 当索引里实在抽不出足够线索时，用这组通用问题补足，保证 UI 不为空。
 * 它们仍贴合"前端逻辑问答"主题，适用于任意 React 项目。
 */
const GENERIC_FALLBACK = [
  "这个项目里有哪些按钮或入口是按条件显示的？",
  "哪些信息在不同业务状态下会展示不同内容？",
  "哪些内容会根据登录用户或权限变化？"
];

const CONFIDENCE_ORDER: Record<LogicFact["confidence"], number> = {
  high: 0,
  medium: 1,
  low: 2
};

/**
 * 基于项目代码索引生成"业务逻辑相关"的推荐问题（聚焦展示/交互规则，不涉及接口、组件等技术细节）。
 * 优先级：可见性条件 → 可用性属性 → 权限/上下文，最后用通用业务问题补足。
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

  // 3) 权限 / 上下文：展示是否随登录用户或权限变化（业务规则）
  if (facts.some((fact) => fact.type === "context" || fact.type === "mobx")) {
    push("哪些内容会根据登录用户或权限变化？");
  }

  // 4) 用通用业务问题补足到 limit
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
 * 只接受含中文的短业务文案，过滤掉变量名、符号等技术碎片。
 */
function readableLabel(target: string | undefined): string | undefined {
  if (!target) return undefined;
  // 三元表达式两侧用 " / " 连接，取第一段；去掉 <Xxx> 组件占位
  let label = (target.split(" / ")[0] ?? target).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!label) return undefined;
  if (label.length > 14) label = label.slice(0, 14);
  // 只接受含中文的业务文案，过滤掉变量名 / 符号等技术碎片
  return /[一-鿿]/.test(label) ? label : undefined;
}
