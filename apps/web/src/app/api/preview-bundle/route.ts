import { analyzeProject } from "@frontend-logic/analyzer";
import type { PreviewBundle, ProjectIndex } from "@frontend-logic/shared";
import { INDEX_SCHEMA_VERSION } from "@frontend-logic/shared";
import { loadIndex, saveIndex } from "@/lib/index-store";
import { projectById } from "@/lib/projects";
import { collectBundle, buildDependencyMap } from "@/lib/preview-bundle";
import { buildMountEntry } from "@/lib/preview-mount";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = (await req.json()) as { projectId?: string; entry?: string; candidates?: string[] };
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = projectById(body.projectId);
  let index = await loadIndex(project.id);
  // 旧版索引缺 routes 等字段，自动重建
  if (!index || index.schemaVersion !== INDEX_SCHEMA_VERSION) {
    index = await analyzeProject(project);
    await saveIndex(index);
  }

  const entry = body.entry?.trim() || pickEntry(index, body.candidates ?? []);
  if (!entry) {
    return NextResponse.json({ error: "找不到可预览的组件文件" }, { status: 404 });
  }

  const collected = await collectBundle(project.rootPath, entry);
  if (Object.keys(collected.files).length === 0) {
    return NextResponse.json({ error: `无法读取入口组件：${entry}` }, { status: 404 });
  }

  const [dependencies, mount] = await Promise.all([
    buildDependencyMap(project.rootPath, collected.npmDependencies),
    buildMountEntry({
      entryRel: collected.entryRel,
      entryComponent: collected.entryComponent,
      files: collected.files
    })
  ]);

  // 组装 Sandpack 文件表：源文件加前导 "/"，挂载入口固定为 /index.js
  const files: Record<string, string> = { "/index.js": mount.code };
  for (const [rel, code] of Object.entries(collected.files)) {
    files[`/${rel}`] = code;
  }

  const bundle: PreviewBundle = {
    entry: collected.entryRel,
    entryComponent: collected.entryComponent,
    files,
    dependencies,
    mountMode: mount.mode
  };
  return NextResponse.json(bundle);
}

/**
 * 路由感知的入口选择：
 * 1. 候选文件（回答的 relatedFiles）中命中路由表的页面组件 —— 渲染问题真正涉及的页面
 * 2. 候选文件中第一个 jsx/tsx
 * 3. 路由表第一个能定位文件的页面
 * 4. 兜底：挑一个最像页面组件的文件
 */
function pickEntry(index: ProjectIndex, candidates: string[]): string | null {
  const routeFiles = new Set(
    (index.routes ?? []).map((route) => route.filePath).filter((file): file is string => Boolean(file))
  );

  const routedCandidate = candidates.find((candidate) => routeFiles.has(candidate));
  if (routedCandidate) return routedCandidate;

  const jsxCandidate = candidates.find((candidate) => /\.(jsx|tsx)$/.test(candidate));
  if (jsxCandidate) return jsxCandidate;

  const firstRouteFile = (index.routes ?? []).find((route) => route.filePath)?.filePath;
  if (firstRouteFile) return firstRouteFile;

  return pickEntryComponent(index);
}

/** 未指定入口时，挑一个最像“页面组件”的文件作为预览入口。 */
function pickEntryComponent(index: ProjectIndex): string | null {
  const jsxComponent = index.files.find(
    (file) => file.components.length > 0 && /\.(jsx|tsx)$/.test(file.filePath)
  );
  if (jsxComponent) return jsxComponent.filePath;

  const anyComponent = index.files.find((file) => file.components.length > 0);
  return anyComponent?.filePath ?? index.files[0]?.filePath ?? null;
}
