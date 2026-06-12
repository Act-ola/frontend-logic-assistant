import { analyzeProject } from "@frontend-logic/analyzer";
import { INDEX_SCHEMA_VERSION } from "@frontend-logic/shared";
import { saveIndex, loadIndex } from "@/lib/index-store";
import { streamAnswer } from "@/lib/ai-answer";
import { projectById } from "@/lib/projects";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = (await req.json()) as { projectId?: string; question?: string };
  if (!body.projectId || !body.question?.trim()) {
    return NextResponse.json({ error: "projectId and question are required" }, { status: 400 });
  }

  const project = projectById(body.projectId);
  let index = await loadIndex(project.id);
  // 版本号不一致说明索引结构过旧（缺 flows/routes 等字段），自动重建一次
  if (!index || index.schemaVersion !== INDEX_SCHEMA_VERSION) {
    index = await analyzeProject(project);
    await saveIndex(index);
  }
  const resolvedIndex = index;
  const question = body.question.trim();

  // 以 NDJSON（每行一个事件）流式返回：trace → reasoning(逐字) → answer
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamAnswer(resolvedIndex, question)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "问答失败";
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}
