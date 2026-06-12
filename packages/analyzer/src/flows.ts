import type { InteractionFlow, FlowRef, LogicFact } from "@frontend-logic/shared";

/**
 * 交互链路构建器：把同一文件内的孤立逻辑事实串成
 * 「用户操作 → handler → 接口调用 → 状态变化 → 页面变化」链路。
 *
 * 串联依据：
 * - 起点：JSX onXxx 绑定的 event_handler 事实（targetText=控件文案，dependencies 含 handler 名）
 * - handler：同文件 targetText=handler 名的 event_handler 函数事实，其 expression 是完整函数源码
 * - 接口：api_call 事实的调用源码出现在 handler 源码内
 * - 状态：state 事实的 setter 名（记录在 dependencies）出现在 handler 源码内
 * - 页面变化：conditional_render / jsx_attribute 的表达式引用了被改变的 state 名
 */
export function buildInteractionFlows(facts: LogicFact[]): InteractionFlow[] {
  const flows: InteractionFlow[] = [];
  const byFile = new Map<string, LogicFact[]>();
  for (const fact of facts) {
    const list = byFile.get(fact.filePath) ?? [];
    list.push(fact);
    byFile.set(fact.filePath, list);
  }

  for (const [filePath, fileFacts] of byFile) {
    const jsxBindings = fileFacts.filter(isJsxEventBinding);
    const handlerFns = fileFacts.filter(
      (fact) => fact.type === "event_handler" && !isJsxEventBinding(fact)
    );
    const apiFacts = fileFacts.filter((fact) => fact.type === "api_call");
    const stateFacts = fileFacts.filter((fact) => fact.type === "state");
    const renderFacts = fileFacts.filter(
      (fact) => fact.type === "conditional_render" || fact.type === "jsx_attribute"
    );

    for (const binding of jsxBindings) {
      const trigger = binding.targetText?.trim();
      if (!trigger) continue; // 没有可读控件文案的链路讲不成人话，跳过

      const eventName = eventNameOf(binding);
      const handlerName = binding.dependencies.find(looksLikeHandlerName);
      const handlerFact = handlerName
        ? handlerFns.find((fact) => fact.targetText === handlerName)
        : undefined;

      // handler 源码：优先具名函数全文，否则用内联表达式本身
      const handlerCode = handlerFact?.expression ?? binding.expression ?? "";
      if (!handlerCode) continue;

      const apiCalls = collectRefs(
        apiFacts.filter((fact) => fact.expression && handlerCode.includes(fact.expression)),
        (fact) => fact.targetText ?? fact.expression ?? "接口调用"
      );

      const changedStates = stateFacts.filter((fact) =>
        fact.dependencies.some((setter) => setter && includesIdentifier(handlerCode, setter))
      );
      const stateChanges = collectRefs(changedStates, (fact) => fact.targetText ?? "state");

      const stateNames = changedStates
        .map((fact) => fact.targetText)
        .filter((name): name is string => Boolean(name));
      const affectedRenders = collectRefs(
        renderFacts.filter((fact) =>
          stateNames.some(
            (name) =>
              (fact.expression && includesIdentifier(fact.expression, name)) ||
              fact.dependencies.includes(name)
          )
        ),
        (fact) => fact.targetText ?? fact.expression ?? "展示逻辑"
      );

      // 一跳都串不出来的链路没有信息量，跳过
      if (!handlerFact && apiCalls.length === 0 && stateChanges.length === 0) continue;

      flows.push({
        id: `${binding.projectId}:${filePath}:flow:${binding.line}:${flows.length + 1}`,
        projectId: binding.projectId,
        filePath,
        componentName: binding.componentName,
        trigger,
        triggerLine: binding.line,
        eventName,
        handlerName: handlerFact?.targetText ?? handlerName,
        handlerLine: handlerFact?.line,
        apiCalls,
        stateChanges,
        affectedRenders,
        confidence:
          handlerFact && (apiCalls.length > 0 || stateChanges.length > 0)
            ? "high"
            : handlerFact
              ? "medium"
              : "low"
      });
    }
  }

  return flows;
}

/** JSX onXxx 绑定事实（区别于具名 handler 函数事实）：以结构化 eventName 字段为准 */
function isJsxEventBinding(fact: LogicFact): boolean {
  return fact.type === "event_handler" && Boolean(fact.eventName);
}

function eventNameOf(fact: LogicFact): string {
  return fact.eventName ?? "onClick";
}

function looksLikeHandlerName(name: string): boolean {
  return /^(handle|on[A-Z]|submit|confirm|cancel|save|export|delete|remove|create|update)/.test(name);
}

/** 全词匹配标识符，避免 setOpen 误匹配 setOpenAll 之类前缀串 */
function includesIdentifier(code: string, identifier: string): boolean {
  if (!identifier) return false;
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`).test(code);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectRefs(facts: LogicFact[], textOf: (fact: LogicFact) => string): FlowRef[] {
  const seen = new Set<string>();
  const refs: FlowRef[] = [];
  for (const fact of facts) {
    const text = clip(textOf(fact));
    const key = `${text}@${fact.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ filePath: fact.filePath, line: fact.line, text });
  }
  return refs.slice(0, 6);
}

function clip(text: string, max = 90): string {
  const compactText = text.replace(/\s+/g, " ").trim();
  return compactText.length > max ? `${compactText.slice(0, max)}…` : compactText;
}

/** 流程类问题的意图词 */
const FLOW_INTENT = /流程|交互|点击|提交|之后|然后|发生什么|会怎样|步骤|顺序|做了什么|干了什么|触发/;

export function isFlowQuestion(question: string): boolean {
  return FLOW_INTENT.test(question);
}

/**
 * 按问题检索最相关的交互链路：
 * trigger 文案整体/片段命中、handler 名命中加分；问题带流程意图词时放宽阈值。
 */
export function matchFlows(
  index: { flows?: InteractionFlow[] },
  question: string,
  relatedFiles: Iterable<string> = [],
  limit = 2
): InteractionFlow[] {
  const flows = index.flows ?? [];
  if (flows.length === 0) return [];
  const intent = isFlowQuestion(question);
  const files = new Set(relatedFiles);

  return flows
    .map((flow) => {
      // matchScore：trigger/handler 实际命中分，决定是否入选
      let matchScore = 0;
      if (flow.trigger && question.includes(flow.trigger)) {
        matchScore += 10;
      } else if (flow.trigger) {
        matchScore += longestSharedFragment(question, flow.trigger);
      }
      if (flow.handlerName && question.toLowerCase().includes(flow.handlerName.toLowerCase())) {
        matchScore += 8;
      }
      // 文件加分只参与排序，不让同文件弱相关链路混入回答
      const rankScore = matchScore + (files.has(flow.filePath) ? 2 : 0);
      return { flow, matchScore, rankScore };
    })
    .filter((item) => (intent ? item.matchScore > 0 : item.matchScore >= 6))
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, limit)
    .map((item) => item.flow);
}

/** 问题与 trigger 的最长公共片段长度（2 字起算），用于"导出按钮"匹配「导出」这类部分命中 */
function longestSharedFragment(question: string, trigger: string): number {
  for (let size = Math.min(6, trigger.length); size >= 2; size -= 1) {
    for (let start = 0; start + size <= trigger.length; start += 1) {
      if (question.includes(trigger.slice(start, start + size))) return size;
    }
  }
  return 0;
}

/** 把链路格式化成带证据位置的步骤列表（本地回答 section / LLM 证据共用） */
export function formatFlowSteps(flow: InteractionFlow): string[] {
  const steps: string[] = [];
  steps.push(
    `操作：用户在「${flow.trigger}」上触发 ${flow.eventName}` +
      (flow.handlerName ? `，进入处理函数 ${flow.handlerName}` : "") +
      `（${flow.filePath}:${flow.handlerLine ?? flow.triggerLine}）`
  );
  for (const api of flow.apiCalls) {
    steps.push(`接口：调用 ${api.text}（${api.filePath}:${api.line}）`);
  }
  for (const state of flow.stateChanges) {
    steps.push(`状态：更新 state ${state.text}（${state.filePath}:${state.line}）`);
  }
  for (const render of flow.affectedRenders) {
    steps.push(`页面：「${render.text}」的展示/可操作状态随之变化（${render.filePath}:${render.line}）`);
  }
  return steps;
}
