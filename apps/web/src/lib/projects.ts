import { ProjectConfigSchema, type ProjectConfig } from "@frontend-logic/shared";
import path from "node:path";
import { workspaceRoot } from "./workspace";

export function configuredProjects(): ProjectConfig[] {
  // 1) 完整配置：一组项目的 JSON（最高优先级）
  const raw = process.env.FRONTEND_ASSISTANT_PROJECTS;
  if (raw) {
    const parsed = JSON.parse(raw) as unknown;
    return ProjectConfigSchema.array().parse(parsed);
  }

  // 2) 便捷配置：只给一个目标目录路径，自动派生项目信息
  const singleRoot = process.env.FRONTEND_ASSISTANT_ROOT?.trim();
  if (singleRoot) {
    return [projectFromRoot(singleRoot)];
  }

  // 3) 兜底：内置 demo 示例项目
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

/** 由单个目录路径派生一个项目配置（相对路径相对于进程工作目录解析）。 */
function projectFromRoot(rawPath: string): ProjectConfig {
  const rootPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  const base = path.basename(rootPath) || "project";
  const id =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";

  return {
    id,
    name: base,
    rootPath,
    branch: "main",
    description: `通过 FRONTEND_ASSISTANT_ROOT 指定的项目目录：${rootPath}`
  };
}

export function projectById(projectId: string) {
  const project = configuredProjects().find((item) => item.id === projectId);
  if (!project) {
    throw new Error(`Unknown project: ${projectId}`);
  }
  return project;
}
