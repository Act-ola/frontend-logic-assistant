import type { ProjectIndex } from "@frontend-logic/shared";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { workspaceRoot } from "./workspace";

function indexDir() {
  return path.join(workspaceRoot(), ".logic-assistant/indexes");
}

export async function saveIndex(index: ProjectIndex) {
  await mkdir(indexDir(), { recursive: true });
  // 先写临时文件再 rename 原子落盘，避免并发重建/读取时出现截断的 JSON
  const target = indexPath(index.project.id);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, JSON.stringify(index, null, 2), "utf8");
  await rename(tmp, target);
}

export async function loadIndex(projectId: string): Promise<ProjectIndex | null> {
  try {
    const content = await readFile(indexPath(projectId), "utf8");
    return JSON.parse(content) as ProjectIndex;
  } catch {
    return null;
  }
}

export async function deleteIndex(projectId: string) {
  await rm(indexPath(projectId), { force: true });
}

function indexPath(projectId: string) {
  return path.join(indexDir(), `${projectId}.json`);
}
