import { suggestQuestionsAI } from "@/lib/ai-suggestions";
import { loadIndex } from "@/lib/index-store";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // 推荐语依赖项目索引；尚未生成索引时返回空，由前端回退到默认问题。
  // gateway 模式用 AI 生成，否则/失败回退本地规则（suggestQuestionsAI 内部处理）。
  const index = await loadIndex(projectId);
  const suggestions = index ? await suggestQuestionsAI(index, 4) : [];

  return NextResponse.json({ suggestions });
}
