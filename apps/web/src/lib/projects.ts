import { ProjectConfigSchema, type ProjectConfig } from "@frontend-logic/shared";
import path from "node:path";
import { workspaceRoot } from "./workspace";

export function configuredProjects(): ProjectConfig[] {
  const raw = process.env.FRONTEND_ASSISTANT_PROJECTS;
  if (raw) {
    const parsed = JSON.parse(raw) as unknown;
    return ProjectConfigSchema.array().parse(parsed);
  }

  const root = workspaceRoot();
  return [
    {
      id: "order-admin-demo",
      name: "Order Admin Demo",
      rootPath: path.join(root, "sample-repos/order-admin-demo"),
      branch: "main",
      description: "内置 React JS/JSX 示例项目，覆盖条件渲染、接口、Context 和 MobX。"
    }
  ];
}

export function projectById(projectId: string) {
  const project = configuredProjects().find((item) => item.id === projectId);
  if (!project) {
    throw new Error(`Unknown project: ${projectId}`);
  }
  return project;
}
