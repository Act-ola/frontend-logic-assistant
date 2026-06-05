import type { LogicFact, ProjectIndex } from "@frontend-logic/shared";
import { suggestQuestions } from "@frontend-logic/analyzer";

/**
 * 推荐问题生成：gateway 模式下用 LLM 分析代码事实生成；
 * 未开 gateway、无事实或 AI 调用失败时，回退到本地规则 suggestQuestions。
 */
export async function suggestQuestionsAI(index: ProjectIndex, limit = 4): Promise<string[]> {
  if (process.env.AI_MODE !== "gateway" || index.facts.length === 0) {
    return suggestQuestions(index, limit);
  }

  try {
    const { generateObject } = await import("ai");
    const { deepseek } = await import("@ai-sdk/deepseek");
    const { z } = await import("zod");

    const digest = buildFactsDigest(index.facts);

    const result = await generateObject({
      model: deepseek(process.env.AI_MODEL || "deepseek-chat"),
      schema: z.object({
        questions: z
          .array(z.string())
          .describe(
            `生成 ${limit} 条业务逻辑相关的中文推荐问题。每条简洁、具体，从产品/测试视角出发，聚焦展示条件、可见性、可操作性、用户与权限差异、不同业务状态下的页面变化等业务规则；不要涉及接口、组件、state、handler、store 等技术实现；避免泛泛而谈、避免重复、不要带序号。`
          )
      }),
      system:
        "你是企业内部前端业务逻辑问答助手的推荐问题生成器。基于提供的代码逻辑事实，站在产品经理和测试工程师的视角，只提出与业务逻辑相关的问题：例如某个按钮/字段/入口在什么条件下显示或隐藏、什么情况下不可操作、不同用户或权限看到的内容差异、不同业务状态下页面如何变化。严禁出现技术实现类问题（如调用了哪些接口、用了哪些组件/state/store、handler 做了什么，以及 API、请求等技术词汇）。只输出业务视角的问题本身。",
      prompt: `项目：${index.project.name}\n\n代码逻辑事实（节选）：\n${digest}\n\n请基于以上线索，生成 ${limit} 条业务逻辑相关、最贴合该项目的中文推荐问题（只问业务规则与展示/交互行为，不要问技术实现）。`
    });

    const questions = Array.from(
      new Set(result.object.questions.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))
    ).slice(0, limit);

    return questions.length > 0 ? questions : suggestQuestions(index, limit);
  } catch {
    return suggestQuestions(index, limit);
  }
}

/** 把逻辑事实压缩成简短摘要喂给模型，控制每个字段长度避免 prompt 过大。 */
function buildFactsDigest(facts: LogicFact[], max = 40): string {
  return facts
    .slice(0, max)
    .map((fact, index) => {
      const parts = [
        `#${index + 1}`,
        `type=${fact.type}`,
        fact.componentName ? `component=${fact.componentName}` : "",
        `file=${fact.filePath}:${fact.line}`,
        fact.targetText ? `target=${clip(fact.targetText)}` : "",
        fact.expression ? `expr=${clip(fact.expression)}` : ""
      ].filter(Boolean);
      return parts.join(" | ");
    })
    .join("\n");
}

function clip(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
