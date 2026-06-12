import { ProjectConfigSchema, type ProjectConfig } from "@frontend-logic/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./workspace";

/**
 * UI 添加的项目持久化在 .logic-assistant/projects.json，
 * 与环境变量 FRONTEND_ASSISTANT_PROJECTS 配置的项目相互独立。
 * 读写保持同步 API，与 projects.ts 的同步调用链一致。
 */

function storePath() {
  return path.join(workspaceRoot(), ".logic-assistant/projects.json");
}

/** clone 出来的仓库统一放置目录 */
export function clonedReposDir() {
  return path.join(workspaceRoot(), ".logic-assistant/repos");
}

export function listStoredProjects(): ProjectConfig[] {
  try {
    const raw = readFileSync(storePath(), "utf8");
    const parsed = ProjectConfigSchema.array().parse(JSON.parse(raw));
    return parsed.map((project) => ({ ...project, source: "stored" as const }));
  } catch {
    return [];
  }
}

export function addStoredProject(project: ProjectConfig): ProjectConfig {
  const existing = listStoredProjects();
  if (existing.some((item) => item.id === project.id)) {
    throw new Error(`项目 id 已存在：${project.id}`);
  }
  const next = [...existing, { ...project, source: "stored" as const }];
  persist(next);
  return project;
}

export function removeStoredProject(projectId: string): ProjectConfig | null {
  const existing = listStoredProjects();
  const target = existing.find((item) => item.id === projectId);
  if (!target) return null;
  persist(existing.filter((item) => item.id !== projectId));
  return target;
}

/** 由项目名生成唯一 id：转 kebab-case，冲突时追加数字后缀 */
export function generateProjectId(name: string, taken: Set<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function persist(projects: ProjectConfig[]) {
  const dir = path.dirname(storePath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(storePath(), JSON.stringify(projects, null, 2), "utf8");
}
