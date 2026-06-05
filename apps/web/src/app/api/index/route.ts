import { analyzeProject } from "@frontend-logic/analyzer";
import { saveIndex } from "@/lib/index-store";
import { projectById } from "@/lib/projects";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = (await req.json()) as { projectId?: string };
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = projectById(body.projectId);
  const index = await analyzeProject(project);
  await saveIndex(index);

  return NextResponse.json({
    project: index.project,
    generatedAt: index.generatedAt,
    files: index.files.length,
    facts: index.facts.length
  });
}
