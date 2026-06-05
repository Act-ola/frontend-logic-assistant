import type { LogicAnswer, LogicFact, ProjectIndex } from "@frontend-logic/shared";
import { retrieveFacts } from "./retrieval";

export function buildLocalAnswer(index: ProjectIndex, question: string): LogicAnswer {
  const { facts, diagnostics } = retrieveFacts(index, question);
  const confidence = confidenceFromFacts(facts, diagnostics.matchedFacts);
  const relatedFiles = Array.from(new Set(facts.map((fact) => fact.filePath))).slice(0, 8);
  const evidence = facts.flatMap((fact) => fact.evidence).slice(0, 8);

  return {
    question,
    conclusion: conclusionFor(question, facts, diagnostics.matchedFacts),
    confidence,
    sections: [
      {
        title: "判断条件",
        items: facts
          .filter((fact) => ["conditional_render", "jsx_attribute"].includes(fact.type))
          .map((fact) => formatFact(fact))
          .slice(0, 6)
      },
      {
        title: "数据与状态来源",
        items: facts
          .filter((fact) => ["api_call", "state", "context", "mobx"].includes(fact.type))
          .map((fact) => formatFact(fact))
          .slice(0, 6)
      },
      {
        title: "交互入口",
        items: facts
          .filter((fact) => fact.type === "event_handler")
          .map((fact) => formatFact(fact))
          .slice(0, 4)
      }
    ].filter((section) => section.items.length > 0),
    relatedFiles,
    evidence,
    usedFacts: facts,
    mode: "local",
    trace: {
      mode: "local",
      totalFacts: diagnostics.totalFacts,
      matchedFacts: diagnostics.matchedFacts,
      usedFacts: facts.length,
      queryTerms: diagnostics.queryTerms
    }
  };
}

function conclusionFor(question: string, facts: LogicFact[], matchedFacts: number): string {
  if (matchedFacts === 0) {
    return "没有命中非常明确的代码证据。下面结果来自当前项目的前几个逻辑事实，建议换一个页面名、按钮文案或接口关键词继续查。";
  }

  const conditional = facts.find((fact) => fact.type === "conditional_render" || fact.type === "jsx_attribute");
  const api = facts.find((fact) => fact.type === "api_call");
  const context = facts.find((fact) => fact.type === "context" || fact.type === "mobx");

  if (/显示|隐藏|按钮|字段|禁用|置灰|可见/.test(question) && conditional) {
    const expanded = expandExpression(conditional, facts);
    const disabled = facts.find(
      (fact) => fact.type === "jsx_attribute" && fact.targetText === conditional.targetText && fact.expression
    );
    const disabledExpression = disabled ? expandExpression(disabled, facts) : "";
    return [
      conditional.targetText
        ? `「${conditional.targetText}」的展示条件是：${expanded}。`
        : `当前最相关的展示/可操作逻辑是：${expanded}。`,
      disabledExpression ? `可操作状态还受这个条件影响：${disabledExpression}。` : "",
      "下方代码证据列出了变量来源、文件和行号。"
    ]
      .filter(Boolean)
      .join("");
  }

  if (/接口|请求|调用|api|数据/.test(question) && api) {
    return `当前最相关的数据来源是接口调用：${api.expression ?? api.targetText ?? api.summary}。`;
  }

  if (/权限|角色|用户|手机号/.test(question) && context) {
    return `当前问题可能依赖用户上下文或 store：${context.expression ?? context.summary}。`;
  }

  return `找到 ${matchedFacts} 条相关代码证据，建议优先查看判断条件和涉及文件。`;
}

function expandExpression(fact: LogicFact, facts: LogicFact[]): string {
  const expression = fact.expression ?? fact.summary;
  if (!fact.expression || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fact.expression)) return expression;
  const expanded = facts.find((candidate) => candidate.targetText === fact.expression && candidate.expression);
  return expanded?.expression ?? expression;
}

function confidenceFromFacts(facts: LogicFact[], matchedFacts: number): LogicAnswer["confidence"] {
  if (matchedFacts === 0) return "low";
  if (facts.some((fact) => fact.confidence === "high") && facts.length >= 2) return "high";
  if (facts.length >= 1) return "medium";
  return "low";
}

function formatFact(fact: LogicFact): string {
  const target = fact.targetText ? `目标「${fact.targetText}」` : "相关逻辑";
  const expression = fact.expression ? `，表达式：${fact.expression}` : "";
  return `${target} 位于 ${fact.filePath}:${fact.line}${expression}`;
}
