import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = [".jsx", ".tsx", ".js", ".ts"];
// react / react-dom 由 Sandpack 的 react 模板自带，无需声明
const TEMPLATE_PROVIDED = new Set(["react", "react-dom"]);

export type CollectedBundle = {
  /** 收集到的本地源文件：相对项目根的 posix 路径 -> 源码 */
  files: Record<string, string>;
  /** 入口文件相对路径（posix） */
  entryRel: string;
  /** 入口 default 导出的组件名（用于展示） */
  entryComponent: string;
  /** 依赖的 npm 顶层包名集合（已排除模板自带） */
  npmDependencies: string[];
};

/**
 * 从入口组件出发，BFS 递归收集其本地 import 的源文件（完整源码），
 * 同时归集 npm 裸模块依赖。所有文件解析都被限制在 project 根目录内。
 */
export async function collectBundle(rootPath: string, entryRel: string): Promise<CollectedBundle> {
  const root = path.resolve(rootPath);
  const files: Record<string, string> = {};
  const npm = new Set<string>();
  const visited = new Set<string>();

  // entry 来自外部输入，resolveModule 已限制在 root 内；解析失败直接返回空，避免越界读文件
  const entryAbs = resolveModule(path.join(root, entryRel), root);
  if (!entryAbs) {
    return { files: {}, entryRel: toPosix(entryRel), entryComponent: "App", npmDependencies: [] };
  }
  const queue: string[] = [entryAbs];

  while (queue.length > 0) {
    const abs = queue.shift() as string;
    if (visited.has(abs)) continue;
    visited.add(abs);

    let code: string;
    try {
      code = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    files[toPosix(path.relative(root, abs))] = code;

    for (const spec of extractImportSpecs(code)) {
      if (isLocalSpec(spec)) {
        const resolved = resolveModule(path.resolve(path.dirname(abs), spec), root);
        if (resolved && !visited.has(resolved)) queue.push(resolved);
      } else {
        const pkg = topLevelPackage(spec);
        if (pkg && !TEMPLATE_PROVIDED.has(pkg)) npm.add(pkg);
      }
    }
  }

  const entryRelPosix = toPosix(path.relative(root, entryAbs));
  return {
    files,
    entryRel: entryRelPosix,
    entryComponent: detectDefaultComponent(files[entryRelPosix] ?? "", entryRelPosix),
    npmDependencies: [...npm]
  };
}

/**
 * 把 npm 包名映射成 Sandpack 需要的 { 包名: 版本 }。
 * 版本优先取项目 package.json，缺省回退 "latest"。
 */
export async function buildDependencyMap(
  rootPath: string,
  npmDependencies: string[]
): Promise<Record<string, string>> {
  const declared = await readDeclaredDeps(rootPath);
  const map: Record<string, string> = {};
  for (const name of npmDependencies) {
    map[name] = declared[name] ?? "latest";
  }
  return map;
}

async function readDeclaredDeps(rootPath: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await readFile(path.join(rootPath, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return { ...(pkg.peerDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  } catch {
    return {};
  }
}

/** 解析一个模块基路径到真实文件：补扩展名、补 index.*，并限制在 root 内。 */
function resolveModule(base: string, root: string): string | null {
  const candidates: string[] = [];
  if (path.extname(base)) candidates.push(base);
  for (const ext of SOURCE_EXTENSIONS) candidates.push(base + ext);
  for (const ext of SOURCE_EXTENSIONS) candidates.push(path.join(base, `index${ext}`));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) continue;
    try {
      if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 用正则提取源码里的 import/export-from/动态 import/require 的模块说明符。 */
function extractImportSpecs(code: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /import\s+[^'"()]*?from\s*["']([^"']+)["']/g,
    /import\s*["']([^"']+)["']/g,
    /export\s+[^'"()]*?from\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      if (match[1]) specs.add(match[1]);
    }
  }
  return [...specs];
}

function isLocalSpec(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/");
}

/** 取裸模块的顶层包名，支持 scoped 包（@scope/name）。 */
function topLevelPackage(spec: string): string {
  if (spec.startsWith("@")) {
    const [scope, name] = spec.split("/");
    return name ? `${scope}/${name}` : scope;
  }
  return spec.split("/")[0];
}

/** 尽量识别入口文件 default 导出的组件名，失败回退文件名。 */
function detectDefaultComponent(code: string, entryRel: string): string {
  const byFunction = code.match(/export\s+default\s+function\s+([A-Z]\w*)/);
  if (byFunction) return byFunction[1];
  const byWrapped = code.match(/export\s+default\s+(?:observer|memo|React\.memo|connect\([^)]*\))?\(?\s*([A-Z]\w*)/);
  if (byWrapped) return byWrapped[1];
  const byDeclared = code.match(/function\s+([A-Z]\w*)\s*\(/) ?? code.match(/(?:const|class)\s+([A-Z]\w*)/);
  if (byDeclared) return byDeclared[1];
  return path.basename(entryRel).replace(/\.\w+$/, "") || "App";
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
