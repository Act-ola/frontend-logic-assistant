import type { LogicFact, ProjectIndex } from "@frontend-logic/shared";

/**
 * 页面级接口清单：按文件聚合 api_call 事实。
 * 页面里常见的是调用 service 封装函数（如 getOrderList()），真实 URL 在 service 文件里；
 * 这里先用「enclosingFunction → URL」建立 service 映射，再把页面侧的函数调用解析成真实接口。
 */

export type ApiUsage = {
  /** 人话标签，如 "getOrderList → GET /api/orders" 或 "GET /api/orders" */
  label: string;
  filePath: string;
  line: number;
};

export type PageApiGroup = {
  filePath: string;
  components: string[];
  apis: ApiUsage[];
};

export type ApiInventoryResult = {
  groups: PageApiGroup[];
  /** 问题中的页面线索是否命中过滤；false 表示未定位到页面、回退为全项目清单 */
  pageMatched: boolean;
};

const API_INVENTORY_INTENT = /哪些接口|什么接口|接口清单|接口列表|调用了哪些|调了哪些|依赖哪些|哪些请求|哪些\s*api/i;

export function isApiInventoryQuestion(question: string): boolean {
  return API_INVENTORY_INTENT.test(question);
}

export function buildApiInventory(index: ProjectIndex, question?: string): ApiInventoryResult {
  const apiFacts = index.facts.filter((fact) => fact.type === "api_call");
  if (apiFacts.length === 0) return { groups: [], pageMatched: false };

  // service 映射：函数名 -> METHOD URL（仅 URL 是字符串字面量的调用才能建立映射）；
  // 同名函数映射到不同 URL 时标记为冲突（null），不做解析，避免跨模块同名封装映射错接口
  const serviceMap = new Map<string, string | null>();
  for (const fact of apiFacts) {
    if (fact.enclosingFunction && fact.targetText) {
      const label = `${methodOf(fact)} ${fact.targetText}`.trim();
      const existing = serviceMap.get(fact.enclosingFunction);
      if (existing === undefined) {
        serviceMap.set(fact.enclosingFunction, label);
      } else if (existing !== label) {
        serviceMap.set(fact.enclosingFunction, null);
      }
    }
  }

  const groups = new Map<string, PageApiGroup>();
  for (const fact of apiFacts) {
    const group = groups.get(fact.filePath) ?? {
      filePath: fact.filePath,
      components: [],
      apis: []
    };
    if (fact.componentName && !group.components.includes(fact.componentName)) {
      group.components.push(fact.componentName);
    }

    const label = labelFor(fact, serviceMap);
    if (label && !group.apis.some((api) => api.label === label)) {
      group.apis.push({ label, filePath: fact.filePath, line: fact.line });
    }
    groups.set(fact.filePath, group);
  }

  let result = Array.from(groups.values()).filter((group) => group.apis.length > 0);

  // 问题中带页面线索（文件名/组件名/路由名）时只保留命中的文件；
  // 零命中时回退全项目清单，并通过 pageMatched=false 让结论如实说明
  let pageMatched = false;
  if (question) {
    const filtered = result.filter((group) => matchesQuestion(group, question, index));
    if (filtered.length > 0) {
      result = filtered;
      pageMatched = true;
    }
  }

  return {
    groups: result.sort((a, b) => b.apis.length - a.apis.length).slice(0, 8),
    pageMatched
  };
}

function labelFor(fact: LogicFact, serviceMap: Map<string, string | null>): string | null {
  // 1. 直接带 URL 字符串的调用
  if (fact.targetText) return `${methodOf(fact)} ${fact.targetText}`.trim();

  // 2. 调用 service 封装函数：解析出封装内的真实接口；
  //    callee 链逐段尝试（getOrderList(...).then 的 callee 是 "getOrderList.then"），
  //    让链式调用归并到同一条已解析记录；冲突（null）的不解析
  const callee = fact.dependencies[0] ?? "";
  const hit = callee.split(".").find((segment) => typeof serviceMap.get(segment) === "string");
  if (hit) {
    return `${hit} → ${serviceMap.get(hit)}`;
  }

  // 3. 解析不出 URL 的调用，保留调用表达式（截断）
  if (fact.expression) {
    const text = fact.expression.replace(/\s+/g, " ").trim();
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  return null;
}

/** 从 callee 名推断 HTTP 方法：request.get / api.post 等；推断不出时返回空 */
function methodOf(fact: LogicFact): string {
  const callee = (fact.dependencies[0] ?? "").toLowerCase();
  const match = /\.(get|post|put|patch|delete)$/.exec(callee);
  if (match) return match[1].toUpperCase();
  if (callee === "fetch") return "";
  return "";
}

function matchesQuestion(group: PageApiGroup, question: string, index: ProjectIndex): boolean {
  const lowerQuestion = question.toLowerCase();
  const baseName = group.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";

  if (baseName.length > 1 && lowerQuestion.includes(baseName.toLowerCase())) return true;
  if (group.components.some((name) => lowerQuestion.includes(name.toLowerCase()))) return true;

  // 路由名命中（如问题里出现「订单列表」且该路由组件就在这个文件）
  return (index.routes ?? []).some(
    (route) =>
      route.filePath === group.filePath &&
      ((route.name && question.includes(route.name)) || lowerQuestion.includes(route.routePath))
  );
}

/** 把清单格式化成回答条目（树形前缀），供本地回答 section 与 LLM 证据共用 */
export function formatApiInventory(groups: PageApiGroup[]): string[] {
  return groups.flatMap((group) => [
    `${group.filePath}${group.components.length > 0 ? `（${group.components.join("、")}）` : ""}`,
    ...group.apis.map((api) => `└ ${api.label}（:${api.line}）`)
  ]);
}
