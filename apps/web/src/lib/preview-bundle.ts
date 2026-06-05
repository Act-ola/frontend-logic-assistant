import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = [".jsx", ".tsx", ".js", ".ts"];
// react / react-dom 由 Sandpack 的 react 模板自带，无需声明
const TEMPLATE_PROVIDED = new Set(["react", "react-dom"]);
// 防止超大项目把整棵依赖树拉进 bundle
const MAX_FILES = 120;

// 常见构建配置文件，用于提取 webpack 的 resolve.alias
const BUILD_CONFIG_FILES = [
  "craco.config.js",
  "config-overrides.js",
  "vue.config.js",
  "webpack.config.js",
  "config/webpack.config.js",
  "build/webpack.base.conf.js",
  "build/webpack.base.js"
];

// Sandpack 里的桩文件
const PKG_STUB_REL = "preview-stubs/__pkg__.js";
const PKG_STUB_PATH = "/preview-stubs/__pkg__";
const ASSET_STUB_REL = "preview-stubs/__asset__.js";
const ASSET_STUB_PATH = "/preview-stubs/__asset__";

// 万能模块桩：任意 default/具名导入都返回安全 noop，避免无法解析的依赖中断渲染
const PKG_STUB_CODE = `const stub = new Proxy(function () {}, {
  get: function (_target, prop) {
    if (prop === "__esModule") return true;
    return stub;
  },
  apply: function () {
    return stub;
  },
  construct: function () {
    return {};
  }
});
module.exports = stub;
`;

// 资源/样式桩：图片、字体、css/less 等非脚本资源返回空，避免打包报错
const ASSET_STUB_CODE = `module.exports = "";\n`;

type AliasRule = { prefix: string; targetDir: string };

export type CollectedBundle = {
  /** 收集到的本地源文件：相对项目根的 posix 路径 -> 源码（别名 import 已重写） */
  files: Record<string, string>;
  /** 入口文件相对路径（posix） */
  entryRel: string;
  /** 入口 default 导出的组件名（用于展示） */
  entryComponent: string;
  /** 真正需要从 npm 安装的依赖（已排除模板自带、别名与打桩项） */
  npmDependencies: string[];
};

/**
 * 从入口组件出发，BFS 递归收集本地源文件，并对依赖做分类处理：
 * - 相对路径 / 路径别名：解析到真实文件并收集（脚本递归；资源/样式打空桩）；
 * - 裸模块：仅 package.json 声明过的才真实安装，其余（未识别的别名、私有包）打万能桩兜底。
 * 所有文件解析都被限制在 project 根目录内。
 */
export async function collectBundle(rootPath: string, entryRel: string): Promise<CollectedBundle> {
  const root = path.resolve(rootPath);
  const aliases = await loadAliasRules(root);
  const declaredDeps = await readDeclaredDeps(root);
  const hasManifest = Object.keys(declaredDeps).length > 0;

  const files: Record<string, string> = {};
  const npm = new Set<string>();
  const visited = new Set<string>();
  let needPkgStub = false;
  let needAssetStub = false;

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
      // 1) 相对路径
      if (isRelativeSpec(spec)) {
        const resolved = resolveModule(path.resolve(path.dirname(abs), spec), root);
        if (resolved && isScriptFile(resolved)) {
          if (!visited.has(resolved)) queue.push(resolved);
        } else {
          rewrites.push([spec, ASSET_STUB_PATH]);
          needAssetStub = true;
        }
        continue;
      }
      // 2) 路径别名（@、@ola、src 等）
      const aliasBase = matchAlias(spec, aliases);
      if (aliasBase) {
        const resolved = resolveModule(aliasBase, root);
        if (resolved && isScriptFile(resolved)) {
          if (!visited.has(resolved)) queue.push(resolved);
          rewrites.push([spec, `/${toPosix(path.relative(root, resolved)).replace(/\.\w+$/, "")}`]);
        } else if (resolved) {
          rewrites.push([spec, ASSET_STUB_PATH]);
          needAssetStub = true;
        } else {
          // 命中别名但找不到文件：打桩兜底，避免 Sandpack 报错
          rewrites.push([spec, PKG_STUB_PATH]);
          needPkgStub = true;
        }
        continue;
      }
      // 3) 裸模块：仅 package.json 声明过的才安装；其余一律打桩兜底
      const pkg = topLevelPackage(spec);
      const declared = declaredDeps[pkg] !== undefined;
      if (declared || (!hasManifest && isLikelyNpmPackage(spec))) {
        if (pkg && !TEMPLATE_PROVIDED.has(pkg)) npm.add(pkg);
      } else {
        rewrites.push([spec, PKG_STUB_PATH]);
        needPkgStub = true;
      }
    }

    files[toPosix(path.relative(root, abs))] = applyRewrites(code, rewrites);
  }

  if (needPkgStub) files[PKG_STUB_REL] = PKG_STUB_CODE;
  if (needAssetStub) files[ASSET_STUB_REL] = ASSET_STUB_CODE;

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

function isScriptFile(filePath: string): boolean {
  return /\.(jsx?|tsx?)$/.test(filePath);
}

/** 是否像一个能从 npm 公共源安装的包名（仅在项目无 package.json 时作为兜底判断）。 */
function isLikelyNpmPackage(spec: string): boolean {
  if (spec.startsWith("@/") || spec.startsWith("~")) return false;
  if (spec.startsWith("@")) return /^@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*/i.test(spec);
  return /^[a-z0-9]/i.test(spec);
}

/** 命中别名时返回展开后的本地基路径，否则 null。按段匹配，最长前缀优先。 */
function matchAlias(spec: string, aliases: AliasRule[]): string | null {
  for (const { prefix, targetDir } of aliases) {
    if (spec === prefix) return targetDir;
    if (spec.startsWith(`${prefix}/`)) return path.join(targetDir, spec.slice(prefix.length + 1));
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

/**
 * 汇总别名规则，来源（按优先级）：
 *  1) tsconfig/jsconfig 的 paths；
 *  2) webpack/craco/vue 配置里可提取的字面 alias；
 *  3) CRA/常见约定默认：@ 与 src 指向 src/。
 * 最终按前缀长度降序，保证最长别名优先匹配。
 */
async function loadAliasRules(root: string): Promise<AliasRule[]> {
  const rules: AliasRule[] = [];
  const seen = new Set<string>();
  const add = (prefix: string, targetDir: string) => {
    const key = normalizePrefix(prefix);
    if (!key || seen.has(key)) return;
    seen.add(key);
    rules.push({ prefix: key, targetDir });
  };

  // 1) tsconfig / jsconfig paths
  for (const cfgName of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const cfg = JSON.parse(await readFile(path.join(root, cfgName), "utf8")) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const baseUrl = cfg.compilerOptions?.baseUrl ?? ".";
      const paths = cfg.compilerOptions?.paths ?? {};
      for (const [key, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets) || !targets[0]) continue;
        const targetRel = String(targets[0]).replace(/\*$/, "").replace(/\/$/, "").replace(/^\.\//, "");
        add(key, path.join(root, baseUrl, targetRel));
      }
    } catch {
      /* ignore */
    }
  }

  // 2) webpack / craco / vue 配置里的字面 alias
  for (const cfgName of BUILD_CONFIG_FILES) {
    for (const rule of await extractBuildAliases(path.join(root, cfgName), root)) {
      add(rule.prefix, rule.targetDir);
    }
  }

  // 3) CRA / 常见默认约定
  if (existsSync(path.join(root, "src"))) {
    add("@", path.join(root, "src"));
    add("src", path.join(root, "src"));
  }

  return rules.sort((a, b) => b.prefix.length - a.prefix.length);
}

/** 从构建配置文件里 best-effort 提取 resolve.alias 中的字面别名。 */
async function extractBuildAliases(cfgPath: string, root: string): Promise<AliasRule[]> {
  let code: string;
  try {
    code = await readFile(cfgPath, "utf8");
  } catch {
    return [];
  }
  const aliasKeyword = code.match(/alias\s*:\s*\{/);
  if (!aliasKeyword || aliasKeyword.index === undefined) return [];
  const block = sliceBalancedBraces(code, aliasKeyword.index + aliasKeyword[0].length - 1);
  if (!block) return [];

  const rules: AliasRule[] = [];
  const entryRe = /["']([^"']+)["']\s*:\s*([^,\n}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(block)) !== null) {
    const targetDir = resolveAliasValue(match[2].trim(), root);
    if (targetDir) rules.push({ prefix: match[1], targetDir });
  }
  return rules;
}

/** 解析 alias 值表达式为目录；纯包名重映射（如 react-native-web）返回 null。 */
function resolveAliasValue(expr: string, root: string): string | null {
  const call = expr.match(/(?:path\.)?(?:resolve|join)\s*\(([^)]*)\)/);
  if (call) {
    const segments = [...call[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    return segments.length > 0 ? path.join(root, ...segments) : root;
  }
  if (/appSrc/.test(expr)) return path.join(root, "src");
  if (/appPath|appDirectory|appRoot/.test(expr)) return root;
  const literal = expr.match(/^["']([^"']+)["']$/);
  if (literal) {
    const value = literal[1];
    // 仅当看起来像路径（相对或含 /）才当目录别名，否则是 npm 包重映射
    if (value.startsWith(".") || value.includes("/")) return path.join(root, value.replace(/^\.\//, ""));
  }
  return null;
}

/** 去掉 alias key 的精确标记 $ 与通配 /* 后缀。 */
function normalizePrefix(key: string): string {
  return key.replace(/\$$/, "").replace(/\/\*?$/, "");
}

/** 从指定位置的 "{" 开始截取平衡花括号内的内容。 */
function sliceBalancedBraces(code: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(openIndex + 1, i);
    }
  }
  return null;
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
