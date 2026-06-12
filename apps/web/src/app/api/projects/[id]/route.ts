import { deleteIndex } from "@/lib/index-store";
import { clonedReposDir, removeStoredProject } from "@/lib/project-store";
import { rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // 只有 stored 项目可删；env/builtin 项目不在 projects.json 里，这里会返回 null
  const removed = removeStoredProject(id);
  if (!removed) {
    return NextResponse.json(
      { error: "项目不存在或不可删除（环境变量配置与内置项目为只读）" },
      { status: 404 }
    );
  }

  await deleteIndex(id);

  // 仅清理我们 clone 出来的仓库目录，用户提供的本地路径不动
  const reposDir = clonedReposDir();
  const resolvedRoot = path.resolve(removed.rootPath);
  if (resolvedRoot.startsWith(`${path.resolve(reposDir)}${path.sep}`)) {
    await rm(resolvedRoot, { recursive: true, force: true });
  }

  return NextResponse.json({ removed: removed.id });
}
