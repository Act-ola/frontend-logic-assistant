import { parse } from "@babel/parser";
import traverseImport, { NodePath } from "@babel/traverse";
import generateImport from "@babel/generator";
import * as t from "@babel/types";
import fg from "fast-glob";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildInteractionFlows } from "./flows";
import type {
  IndexedFile,
  LogicFact,
  LogicFactType,
  ProjectConfig,
  ProjectIndex,
  RouteEntry
} from "@frontend-logic/shared";
import { INDEX_SCHEMA_VERSION } from "@frontend-logic/shared";

const traverse = (
  traverseImport as unknown as {
    default?: typeof traverseImport;
  }
).default ?? traverseImport;

const generate = (
  generateImport as unknown as {
    default?: typeof generateImport;
  }
).default ?? generateImport;

const SOURCE_GLOB = "**/*.{js,jsx,ts,tsx}";
const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/*.test.*",
  "**/*.spec.*"
];

type ParsedRoute = Omit<RouteEntry, "filePath"> & {
  /** 路由组件在声明文件中的 import 来源（相对路径），用于精确定位组件文件 */
  importSource?: string;
};

type ParseResult = {
  file: IndexedFile;
  facts: LogicFact[];
  routes: ParsedRoute[];
};

export async function analyzeProject(project: ProjectConfig): Promise<ProjectIndex> {
  const entries = await fg(SOURCE_GLOB, {
    cwd: project.rootPath,
    ignore: IGNORE_GLOBS,
    absolute: false,
    onlyFiles: true
  });

  const parsed = await Promise.all(
    entries.map(async (filePath) => {
      try {
        const absolutePath = path.join(project.rootPath, filePath);
        const code = await readFile(absolutePath, "utf8");
        return parseFile(project, filePath, code);
      } catch (err) {
        console.warn(`[Logic Assistant] 忽略无法解析的文件 ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    })
  );

  const validParsed = parsed.filter((item): item is ParseResult => item !== null);
  const facts = validParsed.flatMap((item) => item.facts);
  const files = validParsed.map((item) => item.file);

  // 路由组件定位：优先按声明文件中的 import 相对路径解析（不受 import 重命名/同名组件干扰），
  // 解析失败再按组件名在文件表中反查兜底
  const routes: RouteEntry[] = validParsed
    .flatMap((item) => item.routes)
    .map(({ importSource, ...route }) => ({
      ...route,
      filePath:
        resolveRouteFileByImport(route.sourceFilePath, importSource, files) ??
        files.find((file) => file.components.includes(route.componentName))?.filePath
    }));

  return {
    project,
    generatedAt: new Date().toISOString(),
    schemaVersion: INDEX_SCHEMA_VERSION,
    files,
    facts,
    flows: buildInteractionFlows(facts),
    routes
  };
}

export function parseFile(project: ProjectConfig, filePath: string, code: string): ParseResult {
  const ast = parse(code, {
    sourceType: "unambiguous",
    plugins: [
      "jsx",
      "typescript",
      "classProperties",
      "decorators-legacy",
      "dynamicImport",
      "objectRestSpread",
      "optionalChaining",
      "nullishCoalescingOperator"
    ],
    errorRecovery: true
  });

  const imports = new Set<string>();
  /** import 的本地名 -> 来源模块路径，用于解析路由组件的真实文件 */
  const importSources = new Map<string, string>();
  const exports = new Set<string>();
  const components = new Set<string>();
  const facts: LogicFact[] = [];
  const routesFound: ParsedRoute[] = [];

  const addFact = (
    type: LogicFactType,
    pathRef: NodePath<t.Node>,
    options: {
      summary: string;
      expression?: string;
      targetText?: string;
      dependencies?: string[];
      confidence?: LogicFact["confidence"];
      eventName?: string;
    }
  ) => {
    const line = pathRef.node.loc?.start.line ?? 1;
    const id = [
      project.id,
      filePath,
      type,
      line,
      facts.length + 1
    ]
      .join(":")
      .replace(/\s+/g, "-");

    facts.push({
      id,
      projectId: project.id,
      filePath,
      line,
      componentName: findComponentName(pathRef),
      type,
      eventName: options.eventName,
      enclosingFunction: findEnclosingFunctionName(pathRef),
      targetText: compact(options.targetText),
      expression: compact(options.expression),
      summary: options.summary,
      dependencies: Array.from(new Set(options.dependencies ?? [])),
      evidence: [
        {
          filePath,
          line,
          snippet: snippetForNode(code, pathRef.node)
        }
      ],
      confidence: options.confidence ?? "medium"
    });
  };

  traverse(ast, {
    ImportDeclaration(pathRef) {
      imports.add(pathRef.node.source.value);
      for (const specifier of pathRef.node.specifiers) {
        importSources.set(specifier.local.name, pathRef.node.source.value);
      }
    },
    ExportNamedDeclaration(pathRef) {
      for (const specifier of pathRef.node.specifiers) {
        exports.add(specifier.exported.type === "Identifier" ? specifier.exported.name : specifier.exported.value);
      }
    },
    ExportDefaultDeclaration() {
      exports.add("default");
    },
    FunctionDeclaration(pathRef) {
      const name = pathRef.node.id?.name;
      if (name && isComponentName(name) && nodeContainsJsx(pathRef.node.body)) {
        components.add(name);
      }
      if (name && isHandlerName(name)) {
        addFact("event_handler", pathRef as NodePath<t.Node>, {
          summary: `函数 ${name} 是交互处理器，可能触发状态变化或接口调用。`,
          expression: expressionFor(code, pathRef.node),
          targetText: name,
          dependencies: dependencyNames(pathRef.node.body),
          confidence: "medium"
        });
      }
    },
    VariableDeclarator(pathRef) {
      const name = variableName(pathRef.node.id);
      if (name && isComponentName(name) && pathRef.node.init && nodeContainsJsx(pathRef.node.init)) {
        components.add(name);
      }

      if (name && isHandlerName(name) && pathRef.node.init) {
        addFact("event_handler", pathRef as NodePath<t.Node>, {
          summary: `变量 ${name} 是交互处理器，可能触发状态变化或接口调用。`,
          expression: expressionFor(code, pathRef.node.init),
          targetText: name,
          dependencies: dependencyNames(pathRef.node.init),
          confidence: "medium"
        });
      }

      if (name && pathRef.node.init && isLogicVariableName(name) && isLogicExpression(pathRef.node.init)) {
        addFact("conditional_render", pathRef as NodePath<t.Node>, {
          summary: `派生条件变量 ${name} 定义了展示或交互判断。`,
          expression: expressionFor(code, pathRef.node.init),
          targetText: name,
          dependencies: dependencyNames(pathRef.node.init),
          confidence: "high"
        });
      }

      if (t.isArrayPattern(pathRef.node.id) && t.isCallExpression(pathRef.node.init)) {
        const callee = calleeName(pathRef.node.init.callee);
        if (callee === "useState") {
          const stateName = variableName(pathRef.node.id.elements[0]);
          const setterName = variableName(pathRef.node.id.elements[1]);
          addFact("state", pathRef as NodePath<t.Node>, {
            summary: `组件 state ${stateName ?? "unknown"} 由 useState 初始化${
              setterName ? `，通过 ${setterName} 更新` : ""
            }。`,
            expression: expressionFor(code, pathRef.node.init),
            targetText: stateName,
            // setter 名记入 dependencies，供交互链路把 handler 与 state 串起来
            dependencies: setterName ? [setterName] : [],
            confidence: "high"
          });
        }
      }
    },
    AssignmentExpression(pathRef) {
      const left = expressionFor(code, pathRef.node.left);
      if (left.includes("this.state")) {
        addFact("state", pathRef as NodePath<t.Node>, {
          summary: "类组件写入 this.state，可能影响页面展示或交互状态。",
          expression: expressionFor(code, pathRef.node),
          confidence: "medium"
        });
      }
    },
    LogicalExpression(pathRef) {
      if (pathRef.node.operator === "&&" && nodeContainsJsx(pathRef.node.right)) {
        addFact("conditional_render", pathRef as NodePath<t.Node>, {
          summary: "JSX 使用 && 条件渲染，左侧表达式为展示条件。",
          expression: expressionFor(code, pathRef.node.left),
          targetText: extractJsxText(pathRef.node.right),
          dependencies: dependencyNames(pathRef.node.left),
          confidence: "high"
        });
      }
    },
    ConditionalExpression(pathRef) {
      if (nodeContainsJsx(pathRef.node.consequent) || nodeContainsJsx(pathRef.node.alternate)) {
        addFact("conditional_render", pathRef as NodePath<t.Node>, {
          summary: "JSX 使用三元表达式切换不同展示。",
          expression: expressionFor(code, pathRef.node.test),
          targetText: [extractJsxText(pathRef.node.consequent), extractJsxText(pathRef.node.alternate)]
            .filter(Boolean)
            .join(" / "),
          dependencies: dependencyNames(pathRef.node.test),
          confidence: "high"
        });
      }
    },
    IfStatement(pathRef) {
      const consequent = pathRef.node.consequent;
      if (
        t.isBlockStatement(consequent) &&
        consequent.body.some((item) => t.isReturnStatement(item) && (!item.argument || t.isNullLiteral(item.argument)))
      ) {
        addFact("conditional_render", pathRef as NodePath<t.Node>, {
          summary: "代码在条件满足时 return null，表示组件或区域会被隐藏。",
          expression: expressionFor(code, pathRef.node.test),
          dependencies: dependencyNames(pathRef.node.test),
          confidence: "high"
        });
      }
    },
    JSXAttribute(pathRef) {
      const name = jsxAttributeName(pathRef.node.name);
      if (!name) return;

      if (["disabled", "hidden", "readOnly", "readonly"].includes(name) && pathRef.node.value) {
        addFact("jsx_attribute", pathRef as NodePath<t.Node>, {
          summary: `JSX 属性 ${name} 由表达式控制，可能影响可见性或可操作性。`,
          expression: jsxAttributeValue(code, pathRef.node.value),
          targetText: nearestJsxText(pathRef),
          confidence: "high"
        });
      }

      if (name.startsWith("on") && pathRef.node.value) {
        addFact("event_handler", pathRef as NodePath<t.Node>, {
          summary: `交互事件 ${name} 绑定了处理逻辑。`,
          expression: jsxAttributeValue(code, pathRef.node.value),
          targetText: nearestJsxText(pathRef),
          dependencies: dependencyNames(pathRef.node.value),
          confidence: "medium",
          // 结构化记录事件名，交互链路识别不再依赖 summary 文案
          eventName: name
        });
      }
    },
    CallExpression(pathRef) {
      const callee = calleeName(pathRef.node.callee);

      if (callee === "useContext") {
        addFact("context", pathRef as NodePath<t.Node>, {
          summary: "组件读取 React Context，业务逻辑可能依赖上下文中的用户、权限或配置。",
          expression: expressionFor(code, pathRef.node),
          dependencies: pathRef.node.arguments.map((arg) => expressionFor(code, arg)),
          confidence: "high"
        });
      }

      if (callee === "observer" || callee === "inject" || callee.includes("mobx")) {
        addFact("mobx", pathRef as NodePath<t.Node>, {
          summary: "组件接入 MobX，展示逻辑可能依赖 observable store。",
          expression: expressionFor(code, pathRef.node),
          confidence: "medium"
        });
      }

      if (isApiCall(pathRef.node)) {
        addFact("api_call", pathRef as NodePath<t.Node>, {
          summary: "发现接口调用，页面数据或状态可能由该请求驱动。",
          expression: expressionFor(code, pathRef.node),
          targetText: firstStringArgument(pathRef.node),
          dependencies: [callee],
          confidence: firstStringArgument(pathRef.node) ? "high" : "medium"
        });
      }
    },
    MemberExpression(pathRef) {
      const text = expressionFor(code, pathRef.node);
      if (/\bstore\b|Store\b|this\.props\.[A-Za-z0-9_]*Store/.test(text)) {
        addFact("mobx", pathRef as NodePath<t.Node>, {
          summary: "代码读取 store 字段，展示或交互逻辑可能依赖 MobX 状态。",
          expression: text,
          confidence: "low"
        });
      }
    },
    // 路由抽取一：配置对象数组形式，如 { path: "/orders", name: "订单列表", component: OrderList }；
    // 相对 path（嵌套子路由）仅在 children/routes 数组等路由上下文中接受，避免普通配置对象误报
    ObjectExpression(pathRef) {
      const route = routeFromObject(pathRef.node, isInRouteContext(pathRef));
      if (route) {
        routesFound.push({
          ...route,
          importSource: importSources.get(route.componentName),
          sourceFilePath: filePath,
          line: pathRef.node.loc?.start.line ?? 1
        });
      }
    },
    // 路由抽取二：JSX 形式，如 <Route path="/orders" element={<OrderList />} />
    JSXElement(pathRef) {
      const route = routeFromJsxRoute(pathRef.node);
      if (route) {
        routesFound.push({
          ...route,
          importSource: importSources.get(route.componentName),
          sourceFilePath: filePath,
          line: pathRef.node.loc?.start.line ?? 1
        });
      }
    }
  });

  return {
    file: {
      projectId: project.id,
      filePath,
      imports: Array.from(imports),
      exports: Array.from(exports),
      components: Array.from(components),
      codePreview: code.split("\n").slice(0, 12).join("\n")
    },
    facts: dedupeFacts(facts),
    routes: routesFound
  };
}

/**
 * 从配置对象中识别路由：要求 path 为字符串字面量且有 component/element 指向组件。
 * 绝对路径（"/" 开头）直接接受；相对路径（嵌套子路由）仅在路由上下文中接受。
 */
function routeFromObject(
  node: t.ObjectExpression,
  allowRelativePath: boolean
): Pick<RouteEntry, "routePath" | "name" | "componentName"> | null {
  let routePath: string | undefined;
  let name: string | undefined;
  let componentName: string | undefined;

  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || !t.isIdentifier(property.key)) continue;
    const key = property.key.name;
    if (key === "path" && t.isStringLiteral(property.value)) {
      const value = property.value.value;
      if (value.startsWith("/") || allowRelativePath) routePath = value;
    }
    if (key === "name" && t.isStringLiteral(property.value)) {
      name = property.value.value;
    }
    if (key === "component" || key === "element") {
      componentName = componentNameFromValue(property.value);
    }
  }

  if (!routePath || !componentName) return null;
  return { routePath, name, componentName };
}

/**
 * 判断对象是否位于路由上下文：所在数组挂在 children/routes 属性下，
 * 或赋值给名字含 route 的变量（如 export const routes = [...]）。
 */
function isInRouteContext(pathRef: NodePath<t.ObjectExpression>): boolean {
  const arrayPath = pathRef.parentPath;
  if (!arrayPath?.isArrayExpression()) return false;

  const owner = arrayPath.parentPath;
  if (
    owner?.isObjectProperty() &&
    t.isIdentifier(owner.node.key) &&
    /^(children|routes)$/i.test(owner.node.key.name)
  ) {
    return true;
  }
  if (owner?.isVariableDeclarator()) {
    const name = variableName(owner.node.id);
    return Boolean(name && /route/i.test(name));
  }
  return false;
}

/** 从 <Route path="..." element={<X/>}/> 中识别路由 */
function routeFromJsxRoute(
  node: t.JSXElement
): Pick<RouteEntry, "routePath" | "componentName"> | null {
  const opening = node.openingElement;
  if (!t.isJSXIdentifier(opening.name) || opening.name.name !== "Route") return null;

  let routePath: string | undefined;
  let componentName: string | undefined;
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
    if (attr.name.name === "path" && t.isStringLiteral(attr.value)) {
      routePath = attr.value.value;
    }
    if (["element", "component", "render"].includes(attr.name.name) && attr.value) {
      if (t.isJSXExpressionContainer(attr.value)) {
        componentName = componentNameFromValue(attr.value.expression);
      }
    }
  }

  if (!routePath || !componentName) return null;
  return { routePath, componentName };
}

function componentNameFromValue(node: t.Node): string | undefined {
  if (t.isIdentifier(node)) return node.name;
  if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name)) {
    return node.openingElement.name.name;
  }
  return undefined;
}

/** 按路由声明文件中的 import 相对路径解析组件所在文件（匹配补全扩展名与 index 约定） */
function resolveRouteFileByImport(
  sourceFilePath: string,
  importSource: string | undefined,
  files: IndexedFile[]
): string | undefined {
  if (!importSource || !importSource.startsWith(".")) return undefined;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(sourceFilePath)), importSource)
  );
  return files.find((file) => {
    const candidate = toPosix(file.filePath);
    return (
      candidate === base ||
      candidate.replace(/\.[^./]+$/, "") === base ||
      candidate.replace(/\/index\.[^./]+$/, "") === base
    );
  })?.filePath;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** 向上找最近的具名函数（不限组件大写命名），用于把接口调用归属到 service 函数 */
function findEnclosingFunctionName(pathRef: NodePath<t.Node>): string | undefined {
  let current: NodePath<t.Node> | null = pathRef;
  while (current) {
    if (current.isFunctionDeclaration() && current.node.id?.name) {
      return current.node.id.name;
    }
    if (
      current.isVariableDeclarator() &&
      current.node.init &&
      (t.isArrowFunctionExpression(current.node.init) || t.isFunctionExpression(current.node.init))
    ) {
      const name = variableName(current.node.id);
      if (name) return name;
    }
    if ((current.isObjectMethod() || current.isClassMethod()) && t.isIdentifier(current.node.key)) {
      return current.node.key.name;
    }
    current = current.parentPath;
  }
  return undefined;
}

function isComponentName(name: string) {
  return /^[A-Z]/.test(name);
}

function isLogicVariableName(name: string) {
  return /^(can|has|is|show|should|allow|enable|visible|disabled|readonly)|Visible$|Disabled$|Readonly$/i.test(name);
}

function isHandlerName(name: string) {
  return /^(handle|on[A-Z]|submit|confirm|cancel|save|export|delete|remove|create|update)/.test(name);
}

function isLogicExpression(node: t.Node) {
  return (
    t.isLogicalExpression(node) ||
    t.isConditionalExpression(node) ||
    t.isBinaryExpression(node) ||
    t.isUnaryExpression(node) ||
    t.isCallExpression(node) ||
    t.isMemberExpression(node)
  );
}

function variableName(node: t.Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (t.isIdentifier(node)) return node.name;
  if (t.isRestElement(node)) return variableName(node.argument);
  return undefined;
}

function findComponentName(pathRef: NodePath<t.Node>): string | undefined {
  let current: NodePath<t.Node> | null = pathRef;
  while (current) {
    if (current.isFunctionDeclaration()) {
      const name = current.node.id?.name;
      if (name && isComponentName(name)) return name;
    }
    if (current.isClassDeclaration()) {
      const name = current.node.id?.name;
      if (name && isComponentName(name)) return name;
    }
    if (current.isVariableDeclarator()) {
      const name = variableName(current.node.id);
      if (name && isComponentName(name)) return name;
    }
    current = current.parentPath;
  }
  return undefined;
}

function nodeContainsJsx(node: t.Node | null | undefined): boolean {
  if (!node) return false;
  if (t.isJSXElement(node) || t.isJSXFragment(node)) return true;
  const keys = t.VISITOR_KEYS[node.type] ?? [];
  return keys.some((key) => {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.some((item) => t.isNode(item) && nodeContainsJsx(item));
    return t.isNode(value) && nodeContainsJsx(value);
  });
}

function calleeName(node: t.Node): string {
  if (t.isIdentifier(node)) return node.name;
  if (t.isMemberExpression(node)) {
    const objectName = calleeName(node.object);
    const propertyName = t.isIdentifier(node.property)
      ? node.property.name
      : t.isStringLiteral(node.property)
        ? node.property.value
        : "unknown";
    return `${objectName}.${propertyName}`;
  }
  if (t.isCallExpression(node)) return calleeName(node.callee);
  if (t.isThisExpression(node)) return "this";
  return generate(node).code;
}

function isApiCall(node: t.CallExpression): boolean {
  const name = calleeName(node.callee).toLowerCase();
  const firstArg = firstStringArgument(node);
  if (name === "fetch") return true;
  if (name.includes("axios") || name.includes("request") || name.includes("http")) return true;
  if (firstArg && /\.(get|post|put|patch|delete)$/.test(name)) return true;
  if (firstArg && /(^|\.)(api|service|client)\./.test(name)) return true;
  if (/^(get|fetch|request|post|put|patch|delete|remove|update|export)[a-z0-9_]/.test(name)) return true;
  if (/^create(?!context$)[a-z0-9_]/.test(name)) return true;
  return false;
}

function firstStringArgument(node: t.CallExpression): string | undefined {
  const [first] = node.arguments;
  if (t.isStringLiteral(first)) return first.value;
  if (t.isTemplateLiteral(first) && first.quasis.length > 0) {
    return first.quasis.map((quasi) => quasi.value.cooked ?? "").join("${...}");
  }
  return undefined;
}

function expressionFor(code: string, node: t.Node | null | undefined): string {
  if (!node) return "";
  if (typeof node.start === "number" && typeof node.end === "number") {
    return code.slice(node.start, node.end).trim();
  }
  return generate(node).code;
}

function jsxAttributeName(node: t.JSXAttribute["name"]): string | undefined {
  if (t.isJSXIdentifier(node)) return node.name;
  if (t.isJSXNamespacedName(node)) return `${node.namespace.name}:${node.name.name}`;
  return undefined;
}

function jsxAttributeValue(code: string, value: t.JSXAttribute["value"]): string {
  if (!value) return "true";
  if (t.isStringLiteral(value)) return value.value;
  if (t.isJSXExpressionContainer(value)) return expressionFor(code, value.expression);
  return expressionFor(code, value);
}

function extractJsxText(node: t.Node | null | undefined): string | undefined {
  if (!node) return undefined;
  const values: string[] = [];

  const visit = (current: t.Node | null | undefined) => {
    if (!current) return;
    if (t.isJSXText(current)) {
      const text = compact(current.value);
      if (text) values.push(text);
      return;
    }
    if (t.isStringLiteral(current)) {
      values.push(current.value);
      return;
    }
    if (t.isJSXElement(current)) {
      const name = jsxElementName(current.openingElement.name);
      if (name && /^[A-Z]/.test(name)) values.push(`<${name}>`);
    }
    const keys = t.VISITOR_KEYS[current.type] ?? [];
    for (const key of keys) {
      const value = (current as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        value.forEach((item) => t.isNode(item) && visit(item));
      } else if (t.isNode(value)) {
        visit(value);
      }
    }
  };

  visit(node);
  return compact(Array.from(new Set(values)).join(" "));
}

function jsxElementName(node: t.JSXElement["openingElement"]["name"]): string | undefined {
  if (t.isJSXIdentifier(node)) return node.name;
  if (t.isJSXMemberExpression(node)) {
    const objectName = jsxElementName(node.object as t.JSXIdentifier);
    return objectName ? `${objectName}.${node.property.name}` : node.property.name;
  }
  if (t.isJSXNamespacedName(node)) return `${node.namespace.name}:${node.name.name}`;
  return undefined;
}

function nearestJsxText(pathRef: NodePath<t.Node>): string | undefined {
  const opening = pathRef.findParent((parent) => parent.isJSXOpeningElement());
  const element = opening?.parentPath?.node;
  return t.isJSXElement(element) ? extractJsxText(element) : undefined;
}

function dependencyNames(node: t.Node): string[] {
  const names = new Set<string>();
  const visit = (current: t.Node | null | undefined) => {
    if (!current) return;
    if (t.isIdentifier(current)) names.add(current.name);
    if (t.isMemberExpression(current)) names.add(generate(current).code);
    const keys = t.VISITOR_KEYS[current.type] ?? [];
    for (const key of keys) {
      const value = (current as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        value.forEach((item) => t.isNode(item) && visit(item));
      } else if (t.isNode(value)) {
        visit(value);
      }
    }
  };
  visit(node);
  return Array.from(names).slice(0, 12);
}

function snippetForNode(code: string, node: t.Node): string {
  const line = node.loc?.start.line ?? 1;
  const lines = code.split("\n");
  const start = Math.max(0, line - 3);
  const end = Math.min(lines.length, line + 3);
  return lines
    .slice(start, end)
    .map((content, index) => `${start + index + 1}: ${content}`)
    .join("\n");
}

function dedupeFacts(facts: LogicFact[]): LogicFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.type}:${fact.filePath}:${fact.line}:${fact.expression}:${fact.targetText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compact(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}
