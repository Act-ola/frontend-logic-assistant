import { analyzeProject } from "@frontend-logic/analyzer";
import { saveIndex, loadIndex } from "@/lib/index-store";
import { answerQuestion } from "@/lib/ai-answer";
import { projectById } from "@/lib/projects";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = (await req.json()) as { projectId?: string; question?: string };
  if (!body.projectId || !body.question?.trim()) {
    return NextResponse.json({ error: "projectId and question are required" }, { status: 400 });
  }

  const project = projectById(body.projectId);
  let index = await loadIndex(project.id);

  if (!index) {
    index = await analyzeProject(project);
    await saveIndex(index);
  }

  const answer = await answerQuestion(index, body.question.trim());
  return NextResponse.json(answer);
}
