import { ProjectConfigSchema, type ProjectConfig } from "@frontend-logic/shared";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./workspace";

let storeLock: Promise<unknown> = Promise.resolve();

/**
 * 串行化对项目配置的读-改-写，避免并发请求互相覆盖 projects.json
 * 或生成重复的项目 id（单进程内有效，足够当前部署形态）。
 */
export function withProjectStoreLock<T>(task: () => Promise<T> | T): Promise<T> {
  const run = storeLock.then(task, task);
  storeLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

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
  if (!existsSync(storePath())) return [];
  try {
    const raw = readFileSync(storePath(), "utf8");
    const parsed = ProjectConfigSchema.array().parse(JSON.parse(raw));
    return parsed.map((project) => ({ ...project, source: "stored" as const }));
  } catch (err) {
    // 文件损坏时不要静默吞掉，留下排查线索
    console.warn(
      `[Logic Assistant] projects.json 读取失败，已忽略其中配置：${
        err instanceof Error ? err.message : String(err)
      }`
    );
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
  const target = storePath();
  const dir = path.dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 先写临时文件再 rename，保证原子写入，进程中断不会截断配置
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(projects, null, 2), "utf8");
  renameSync(tmp, target);
}
