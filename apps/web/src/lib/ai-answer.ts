import type { AskStreamEvent, AnswerTrace, LogicAnswer, LogicFact, ProjectIndex } from "@frontend-logic/shared";
import { buildLocalAnswer, retrieveFacts } from "@frontend-logic/analyzer";

/**
 * 流式问答：依次产出
 *  1) trace —— 调用详情元信息（模型、查询词、命中事实数等），前端可立即展示；
 *  2) reasoning —— AI 的思考过程增量，前端逐字追加，实时呈现"边想边答"；
 *  3) answer —— 思考结束后的完整答案（结论 + 页面预览）。
 *
 * Gateway 模式走真实 LLM（先 streamText 流式思考，再 generateObject 出结论/预览）；
 * 未开 Gateway 或无命中事实时，用本地推理生成思考文本并分块伪流式输出。
 */
export async function* streamAnswer(
  index: ProjectIndex,
  question: string
): AsyncGenerator<AskStreamEvent> {
  const start = Date.now();
  const { facts, diagnostics } = retrieveFacts(index, question);
  const local = buildLocalAnswer(index, question);
  const useGateway = process.env.AI_MODE === "gateway" && facts.length > 0;
  const model = process.env.AI_MODEL || "deepseek-chat";
  const evidence = buildEvidence(facts);

  // 1) 先下发调用详情，面板可在思考开始前就展示模型/查询词/命中情况
  const baseTrace: AnswerTrace = {
    mode: useGateway ? "gateway" : "local",
    model: useGateway ? model : undefined,
    totalFacts: diagnostics.totalFacts,
    matchedFacts: diagnostics.matchedFacts,
    usedFacts: facts.length,
    queryTerms: diagnostics.queryTerms,
    promptChars: evidence.length
  };
  // 逻辑事实与代码证据在检索阶段就已确定，随 trace 一起提前下发，前端可在思考开始时即渲染
  yield { type: "trace", trace: baseTrace, facts: facts.slice(0, 8), evidence: local.evidence };

  let reasoning = "";

  // 2) 本地模式：基于检索诊断构造思考过程，分块伪流式输出
  if (!useGateway) {
    const thinking = buildLocalReasoning(question, facts, diagnostics);
    for (const chunk of chunkText(thinking)) {
      reasoning += chunk;
      yield { type: "reasoning", delta: chunk };
      await sleep(18);
    }
    const answer: LogicAnswer = {
      ...local,
      trace: { ...baseTrace, reasoning, durationMs: Date.now() - start }
    };
    yield { type: "answer", answer };
    return;
  }

  // 3) Gateway 模式：真实 LLM —— 先流式思考，再结构化出结论与预览
  try {
    const { streamText, generateObject } = await import("ai");
    const { deepseek } = await import("@ai-sdk/deepseek");
    const { z } = await import("zod");

    const thinkingStream = streamText({
      model: deepseek(model),
      system:
        "你是企业内部前端逻辑分析师。基于提供的代码证据，围绕用户问题逐步推理：先定位相关的判断条件、数据来源与交互入口，再一步步推导出结论。用中文、分点、口语化地把思考过程讲出来，像在边想边说；不要输出 HTML，也不要急着给最终结论。",
      prompt: `用户问题：${question}\n\n代码证据：\n${evidence}\n\n请逐步思考并分析。`
    });

    for await (const delta of thinkingStream.textStream) {
      reasoning += delta;
      yield { type: "reasoning", delta };
    }

    // 思考完成后，基于推理过程生成简洁结论与高仿真页面预览
    const structured = await generateObject({
      model: deepseek(model),
      schema: z.object({
        conclusion: z
          .string()
          .describe("用中文回答用户问题，结论简洁明确、直击要点。证据不足时明确说明不确定。"),
        previewHtml: z
          .string()
          .describe(
            "根据提取的代码逻辑，写一段完整的单文件 HTML 代码（需包含 <html> <body> 结构和 Tailwind CSS 的 CDN 引入）。该页面应高仿真模拟代码片段代表的 UI 界面，使用 mock 数据，确保能独立在 iframe 内漂亮地渲染出来。包含交互的请用内联简单的 script 实现。"
          )
      }),
      system:
        "你是企业内部前端逻辑问答助手。基于代码证据与已有的分析推理，给出结论并生成直观的高仿真页面预览。",
      prompt: `用户问题：${question}\n\n分析推理：\n${reasoning}\n\n代码证据：\n${evidence}`
    });

    const answer: LogicAnswer = {
      ...local,
      conclusion: structured.object.conclusion || local.conclusion,
      previewHtml: structured.object.previewHtml,
      mode: "gateway",
      trace: { ...baseTrace, mode: "gateway", model, reasoning, durationMs: Date.now() - start }
    };
    yield { type: "answer", answer };
  } catch (err) {
    // AI 调用失败：补一句说明并回退本地答案，保证前端有完整结果
    const note = `\n\n（AI 调用失败，已回退本地推理：${err instanceof Error ? err.message : "未知错误"}）`;
    reasoning += note;
    yield { type: "reasoning", delta: note };
    const answer: LogicAnswer = {
      ...local,
      trace: { ...baseTrace, mode: "local", model: undefined, reasoning, durationMs: Date.now() - start }
    };
    yield { type: "answer", answer };
  }
}

/** 把命中的逻辑事实压成喂给模型的证据文本。 */
function buildEvidence(facts: LogicFact[]): string {
  return facts
    .slice(0, 8)
    .map((fact, i) =>
      [
        `#${i + 1}`,
        `type: ${fact.type}`,
        `file: ${fact.filePath}:${fact.line}`,
        `component: ${fact.componentName ?? "unknown"}`,
        `target: ${fact.targetText ?? "unknown"}`,
        `expression: ${fact.expression ?? "unknown"}`,
        `snippet:\n${fact.evidence[0]?.snippet ?? ""}`
      ].join("\n")
    )
    .join("\n\n");
}

/** 本地模式下，根据检索诊断构造一段可读的"思考过程"。 */
function buildLocalReasoning(
  question: string,
  facts: LogicFact[],
  diagnostics: { totalFacts: number; matchedFacts: number; queryTerms: string[] }
): string {
  const lines: string[] = [];
  lines.push(`收到问题：「${question}」。`);
  lines.push(
    `先在已索引的 ${diagnostics.totalFacts} 条逻辑事实里检索关键词：${
      diagnostics.queryTerms.join("、") || "（无显式关键词，按相关度兜底）"
    }。`
  );
  lines.push(`命中 ${diagnostics.matchedFacts} 条相关事实，采用其中 ${facts.length} 条作为推理依据。`);
  if (facts.length > 0) {
    const top = facts
      .slice(0, 3)
      .map((fact) => `${fact.targetText ?? fact.type}（${fact.filePath}:${fact.line}）`)
      .join("；");
    lines.push(`重点核对这几条证据：${top}。`);
    lines.push(`逐条比对它们的判断条件、数据来源与交互入口后，归纳出结论。`);
  } else {
    lines.push(`没有命中明确证据，建议换一个页面名、按钮文案或接口关键词再问一次。`);
  }
  return lines.join("\n");
}

/** 把文本切成小块，用于本地模式的伪流式输出。 */
function chunkText(text: string, size = 6): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
