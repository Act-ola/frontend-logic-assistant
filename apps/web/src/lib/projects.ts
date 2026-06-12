import { ProjectConfigSchema, type ProjectConfig } from "@frontend-logic/shared";
import path from "node:path";
import { listStoredProjects } from "./project-store";
import { workspaceRoot } from "./workspace";

/**
 * 项目列表合并三路来源（id 冲突时排前者优先）：
 * 1. env：FRONTEND_ASSISTANT_PROJECTS 环境变量，只读；
 * 2. stored：UI 添加并持久化到 .logic-assistant/projects.json，可增删；
 * 3. builtin：前两者都为空时回退内置 demo。
 */
export function configuredProjects(): ProjectConfig[] {
  const envProjects = envConfiguredProjects();
  const storedProjects = listStoredProjects();

  const merged: ProjectConfig[] = [...envProjects];
  for (const project of storedProjects) {
    if (!merged.some((item) => item.id === project.id)) merged.push(project);
  }
  if (merged.length > 0) return merged;

  const root = workspaceRoot();
  return [
    {
      id: "order-admin-demo",
      name: "Order Admin Demo",
      rootPath: path.join(root, "sample-repos/order-admin-demo"),
      branch: "main",
      description: "内置 React JS/JSX 示例项目，覆盖条件渲染、接口、Context 和 MobX。",
      source: "builtin"
    }
  ];
}

function envConfiguredProjects(): ProjectConfig[] {
  const raw = process.env.FRONTEND_ASSISTANT_PROJECTS;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  return ProjectConfigSchema.array()
    .parse(parsed)
    .map((project) => ({ ...project, source: "env" as const }));
}

export function projectById(projectId: string) {
  const project = configuredProjects().find((item) => item.id === projectId);
  if (!project) {
    throw new Error(`Unknown project: ${projectId}`);
  }
  return project;
}
