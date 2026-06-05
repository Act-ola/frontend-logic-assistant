import type { LogicFact, ProjectIndex } from "@frontend-logic/shared";

export type RetrievalResult = {
  facts: LogicFact[];
  diagnostics: {
    totalFacts: number;
    matchedFacts: number;
    queryTerms: string[];
  };
};

export function retrieveFacts(index: ProjectIndex, question: string, limit = 12): RetrievalResult {
  const terms = queryTerms(question);
  const scored = index.facts
    .map((fact) => ({ fact, score: scoreFact(fact, question, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.fact);

  const expanded = expandByDependencies(index.facts, scored, limit);
  const fallback = expanded.length > 0 ? expanded : index.facts.slice(0, Math.min(limit, 6));

  return {
    facts: fallback,
    diagnostics: {
      totalFacts: index.facts.length,
      matchedFacts: scored.length,
      queryTerms: terms
    }
  };
}

function expandByDependencies(allFacts: LogicFact[], seedFacts: LogicFact[], limit: number): LogicFact[] {
  const picked = new Map(seedFacts.map((fact) => [fact.id, fact]));
  const dependencies = new Set(
    seedFacts
      .flatMap((fact) => [...fact.dependencies, fact.expression ?? ""])
      .flatMap((value) => value.match(/[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g) ?? [])
      .filter((value) => value.length > 2)
  );

  for (const fact of allFacts) {
    if (picked.size >= limit) break;
    const haystack = [fact.targetText, fact.expression, fact.summary, fact.dependencies.join(" ")]
      .filter(Boolean)
      .join(" ");
    for (const dependency of dependencies) {
      if (haystack.includes(dependency)) {
        picked.set(fact.id, fact);
        break;
      }
    }
  }

  return Array.from(picked.values()).slice(0, limit);
}

function scoreFact(fact: LogicFact, question: string, terms: string[]): number {
  const haystack = [
    fact.filePath,
    fact.componentName,
    fact.type,
    fact.targetText,
    fact.expression,
    fact.summary,
    fact.dependencies.join(" "),
    fact.evidence.map((item) => item.snippet).join("\n")
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  const normalizedQuestion = normalize(question);
  let score = 0;
  if (normalizedQuestion && haystack.includes(normalizedQuestion)) score += 12;

  for (const term of terms) {
    if (!term) continue;
    if (haystack.includes(term)) score += term.length > 1 ? 4 : 1;
    if (fact.targetText?.toLowerCase().includes(term)) score += 8;
    if (fact.filePath.toLowerCase().includes(term)) score += 5;
    if (fact.expression?.toLowerCase().includes(term)) score += 5;
  }

  if (/显示|隐藏|可见|按钮|字段|禁用|置灰/.test(question) && fact.type.includes("conditional")) score += 6;
  if (/接口|请求|调用|api|数据/.test(question) && fact.type === "api_call") score += 8;
  if (/权限|角色|用户|手机号|登录/.test(question) && ["context", "mobx", "conditional_render"].includes(fact.type)) {
    score += 4;
  }
  if (/状态|loading|列表|数据/.test(question) && ["state", "api_call"].includes(fact.type)) score += 3;

  return score;
}

function queryTerms(question: string): string[] {
  const normalized = normalize(question);
  const asciiWords = normalized.match(/[a-z0-9_./-]+/g) ?? [];
  const cjk = Array.from(new Set((question.match(/[\u4e00-\u9fff]+/g) ?? []).flatMap(cjkNgrams)));
  return Array.from(new Set([...asciiWords, ...cjk])).filter((item) => item.length > 0);
}

function cjkNgrams(text: string): string[] {
  const clean = text.trim();
  if (clean.length <= 2) return [clean];
  const grams = new Set<string>();
  for (let size = 2; size <= Math.min(4, clean.length); size += 1) {
    for (let index = 0; index <= clean.length - size; index += 1) {
      grams.add(clean.slice(index, index + size));
    }
  }
  return Array.from(grams);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
