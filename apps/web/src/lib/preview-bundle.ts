import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = [".jsx", ".tsx", ".js", ".ts"];
// react / react-dom 由 Sandpack 的 react 模板自带，无需声明
const TEMPLATE_PROVIDED = new Set(["react", "react-dom"]);
// 防止超大项目把整棵依赖树拉进 bundle
const MAX_FILES = 120;

type AliasRule = { prefix: string; targetDir: string };

export type CollectedBundle = {
  /** 收集到的本地源文件：相对项目根的 posix 路径 -> 源码（别名 import 已重写为绝对路径） */
  files: Record<string, string>;
  /** 入口文件相对路径（posix） */
  entryRel: string;
  /** 入口 default 导出的组件名（用于展示） */
  entryComponent: string;
  /** 依赖的 npm 顶层包名集合（已排除模板自带与路径别名） */
  npmDependencies: string[];
};

/**
 * 从入口组件出发，BFS 递归收集其本地 import 的源文件（完整源码），同时归集 npm 裸模块依赖。
 * - 相对路径 import：Sandpack 原样可解析；
 * - 路径别名（如 @/...）：解析到真实文件并收集，同时把 import 重写为 Sandpack 绝对路径；
 * - npm 裸模块：仅收合法包名，避免把别名误当依赖导致 Sandpack 拉取失败。
 * 所有文件解析都被限制在 project 根目录内。
 */
export async function collectBundle(rootPath: string, entryRel: string): Promise<CollectedBundle> {
  const root = path.resolve(rootPath);
  const aliases = await loadAliasRules(root);
  const files: Record<string, string> = {};
  const npm = new Set<string>();
  const visited = new Set<string>();

  // entry 来自外部输入，resolveModule 已限制在 root 内；解析失败直接返回空，避免越界读文件
  const entryAbs = resolveModule(path.join(root, entryRel), root);
  if (!entryAbs) {
    return { files: {}, entryRel: toPosix(entryRel), entryComponent: "App", npmDependencies: [] };
  }
  const queue: string[] = [entryAbs];

  while (queue.length > 0 && Object.keys(files).length < MAX_FILES) {
    const abs = queue.shift() as string;
    if (visited.has(abs)) continue;
    visited.add(abs);

    let code: string;
    try {
      code = await readFile(abs, "utf8");
    } catch {
      continue;
    }

    const rewrites: Array<[string, string]> = [];
    for (const spec of extractImportSpecs(code)) {
      // 1) 相对/绝对本地路径：Sandpack 按文件结构即可解析
      if (isRelativeSpec(spec)) {
        const resolved = resolveModule(path.resolve(path.dirname(abs), spec), root);
        if (resolved && !visited.has(resolved)) queue.push(resolved);
        continue;
      }
      // 2) 路径别名（如 @/...）：解析到本地文件并收集，把 import 重写成 Sandpack 绝对路径
      const aliasBase = matchAlias(spec, aliases);
      if (aliasBase) {
        const resolved = resolveModule(aliasBase, root);
        if (resolved) {
          if (!visited.has(resolved)) queue.push(resolved);
          const sandpackPath = `/${toPosix(path.relative(root, resolved)).replace(/\.\w+$/, "")}`;
          rewrites.push([spec, sandpackPath]);
        }
        continue;
      }
      // 3) 合法 npm 裸模块才进依赖；未知别名 / 非法名一律忽略，避免拉取不存在的依赖
      if (isLikelyNpmPackage(spec)) {
        const pkg = topLevelPackage(spec);
        if (pkg && !TEMPLATE_PROVIDED.has(pkg)) npm.add(pkg);
      }
    }

    files[toPosix(path.relative(root, abs))] = applyRewrites(code, rewrites);
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

function isRelativeSpec(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/");
}

/** 是否像一个能从 npm 公共源安装的包名（排除路径别名 @/ 与 ~）。 */
function isLikelyNpmPackage(spec: string): boolean {
  if (spec.startsWith("@/") || spec.startsWith("~")) return false;
  if (spec.startsWith("@")) return /^@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*/i.test(spec);
  return /^[a-z0-9]/i.test(spec);
}

/** 命中别名时返回展开后的本地基路径，否则 null。 */
function matchAlias(spec: string, aliases: AliasRule[]): string | null {
  for (const { prefix, targetDir } of aliases) {
    if (spec.startsWith(prefix)) {
      return path.join(targetDir, spec.slice(prefix.length));
    }
  }
  return null;
}

/** 把源码里别名 import 的说明符（连同引号）整体替换成新的路径。 */
function applyRewrites(code: string, rewrites: Array<[string, string]>): string {
  let out = code;
  for (const [from, to] of rewrites) {
    out = out.split(`"${from}"`).join(`"${to}"`).split(`'${from}'`).join(`'${to}'`);
  }
  return out;
}

/** 读 tsconfig/jsconfig 的 paths 生成别名规则，缺失或解析失败时回退默认 @/ -> src/。 */
async function loadAliasRules(root: string): Promise<AliasRule[]> {
  for (const cfgName of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const cfg = JSON.parse(await readFile(path.join(root, cfgName), "utf8")) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const baseUrl = cfg.compilerOptions?.baseUrl ?? ".";
      const paths = cfg.compilerOptions?.paths ?? {};
      const rules: AliasRule[] = [];
      for (const [key, targets] of Object.entries(paths)) {
        if (!key.endsWith("/*") || !targets?.[0]) continue;
        const prefix = key.slice(0, -1); // "@/*" -> "@/"
        const targetRel = targets[0].replace(/\*$/, "").replace(/^\.\//, "");
        rules.push({ prefix, targetDir: path.join(root, baseUrl, targetRel) });
      }
      if (rules.length > 0) return rules;
    } catch {
      /* 配置缺失或含注释解析失败，尝试下一个或回退默认 */
    }
  }
  return existsSync(path.join(root, "src")) ? [{ prefix: "@/", targetDir: path.join(root, "src") }] : [];
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
