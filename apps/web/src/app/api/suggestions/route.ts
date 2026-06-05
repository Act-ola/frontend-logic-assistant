import { suggestQuestions } from "@frontend-logic/analyzer";
import { loadIndex } from "@/lib/index-store";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // 推荐语依赖项目索引；尚未生成索引时返回空，由前端回退到默认问题。
  const index = await loadIndex(projectId);
  const suggestions = index ? suggestQuestions(index, 4) : [];

  return NextResponse.json({ suggestions });
}
