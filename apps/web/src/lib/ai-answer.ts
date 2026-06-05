import type { LogicAnswer, ProjectIndex } from "@frontend-logic/shared";
import { buildLocalAnswer, retrieveFacts } from "@frontend-logic/analyzer";

export async function answerQuestion(index: ProjectIndex, question: string): Promise<LogicAnswer> {
  if (process.env.AI_MODE !== "gateway") {
    return buildLocalAnswer(index, question);
  }

  const { facts } = retrieveFacts(index, question);
  if (facts.length === 0) return buildLocalAnswer(index, question);

  const local = buildLocalAnswer(index, question);
  const { generateObject } = await import("ai");
  const { deepseek } = await import("@ai-sdk/deepseek");
  const { z } = await import("zod");

  const evidence = facts
    .slice(0, 8)
    .map((fact, index) => {
      return [
        `#${index + 1}`,
        `type: ${fact.type}`,
        `file: ${fact.filePath}:${fact.line}`,
        `component: ${fact.componentName ?? "unknown"}`,
        `target: ${fact.targetText ?? "unknown"}`,
        `expression: ${fact.expression ?? "unknown"}`,
        `snippet:\n${fact.evidence[0]?.snippet ?? ""}`
      ].join("\n");
    })
    .join("\n\n");

  const model = process.env.AI_MODEL || "deepseek-chat";
  const result = await generateObject({
    model: deepseek(model),
    schema: z.object({
      conclusion: z.string().describe("用中文回答，结论简洁，列出判断条件、数据来源、涉及文件。证据不足时明确说不确定。"),
      previewHtml: z.string().describe("根据提取的代码逻辑，写一段完整的单文件 HTML 代码（需包含 <html> <body> 结构和 Tailwind CSS 的 CDN 引入）。该页面应该高仿真模拟代码片段代表的 UI 界面，使用 mock 数据，确保能够独立在 iframe 内漂亮地渲染出来。包含交互的请用内联简单的 script 实现。")
    }),
    system:
      "你是企业内部前端逻辑问答助手。你的任务是根据提供的代码证据回答用户的疑问，并生成直观的高仿真页面预览。",
    prompt: `用户问题：${question}\n\n代码证据：\n${evidence}`
  });

  return {
    ...local,
    conclusion: result.object.conclusion || local.conclusion,
    previewHtml: result.object.previewHtml,
    mode: "gateway",
    trace: local.trace ? { ...local.trace, mode: "gateway", model } : undefined
  };
}
