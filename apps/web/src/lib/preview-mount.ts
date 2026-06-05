/**
 * 生成 Sandpack 的挂载入口 /index.js：把真实业务组件渲染出来。
 * - gateway：让 AI 读组件与依赖源码，生成挂载代码并注入 Provider 默认值 + 接口 mock，让界面有内容；
 * - local / AI 失败：用通用模板兜底（仅拦截 fetch 返回空，直接挂载组件）。
 */
export type MountResult = { code: string; mode: "local" | "gateway" };

export async function buildMountEntry(args: {
  entryRel: string;
  entryComponent: string;
  files: Record<string, string>;
}): Promise<MountResult> {
  const importPath = `./${args.entryRel.replace(/\.\w+$/, "")}`;

  if (process.env.AI_MODE !== "gateway") {
    return { code: localMount(importPath), mode: "local" };
  }

  try {
    const code = await aiMount(args, importPath);
    return { code: code.trim() ? code : localMount(importPath), mode: code.trim() ? "gateway" : "local" };
  } catch {
    return { code: localMount(importPath), mode: "local" };
  }
}

/** 通用兜底挂载：拦截 fetch 返回空数据，直接渲染组件。 */
function localMount(importPath: string): string {
  return `import React from "react";
import { createRoot } from "react-dom/client";
import Component from "${importPath}";

// 通用接口 mock：避免真实网络请求导致报错（统一返回空数据）
if (typeof window !== "undefined") {
  window.fetch = () =>
    Promise.resolve(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
    );
}

const container = document.getElementById("root");
createRoot(container).render(<Component />);
`;
}

/** 让 AI 生成挂载入口：注入 Provider 默认值 + 贴合业务的接口 mock。 */
async function aiMount(
  args: { entryRel: string; entryComponent: string; files: Record<string, string> },
  importPath: string
): Promise<string> {
  const { generateObject } = await import("ai");
  const { deepseek } = await import("@ai-sdk/deepseek");
  const { z } = await import("zod");

  const model = process.env.AI_MODEL || "deepseek-chat";
  const entryCode = args.files[args.entryRel] ?? "";
  const depDigest = buildDependencyDigest(args.files, args.entryRel);

  const result = await generateObject({
    model: deepseek(model),
    schema: z.object({
      mountCode: z
        .string()
        .describe("Sandpack(react 模板) 的完整 /index.js 源码，纯 JS + JSX。")
    }),
    system:
      "你在为 Sandpack（react 模板）生成挂载入口 index.js，目标是把真实业务组件渲染出来并填满 mock 数据，让预览有内容。只输出可直接运行的 index.js 源码。",
    prompt: [
      `入口组件从 "${importPath}" default 导出（组件名约为 ${args.entryComponent}）。`,
      "",
      "硬性要求：",
      `1. 用 react-dom/client 的 createRoot 挂载到 id 为 root 的节点：const root = createRoot(document.getElementById("root"));`,
      `2. 从 "${importPath}" 引入入口组件并渲染。`,
      "3. 若组件依赖 React Context（如读取登录用户 user、权限 permissions、功能开关 featureFlags 等），务必 import 对应的 Provider 并注入合理默认值：user 给一个完整对象（含 role 等字段）、permissions 给齐相关权限字符串、featureFlags 相关开关置 true，确保组件不会因为缺登录态而走 return null 渲染空白。",
      "4. 覆盖 window.fetch，拦截组件用到的接口，返回字段完整、贴合业务的 mock 数据（列表类接口给 2-3 条数据），让界面有内容；fetch 要返回带 json()/ok 的对象。",
      "5. 所有本地源文件都位于其相对路径下，从 index.js 引用要用 './' 加该相对路径（去掉扩展名），例如 './src/context/AuthContext'。只能引用下方列出的文件，不要 import CSS、图片或不存在的模块。",
      "6. 只输出 index.js 的完整代码，不要修改其它源文件，不要使用 markdown 代码块包裹。",
      "",
      `入口组件源码（${args.entryRel}）：`,
      entryCode,
      "",
      "可引用的本地文件及其内容（节选）：",
      depDigest
    ].join("\n")
  });

  return stripCodeFence(result.object.mountCode);
}

/** 剥离模型可能附带的 markdown 代码块围栏（```js ... ```）。 */
function stripCodeFence(code: string): string {
  const trimmed = code.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

/** 把入口以外的本地文件压成带路径标注的节选，喂给模型作为依赖上下文。 */
function buildDependencyDigest(files: Record<string, string>, entryRel: string): string {
  return Object.entries(files)
    .filter(([rel]) => rel !== entryRel)
    .slice(0, 12)
    .map(([rel, code]) => {
      const snippet = code.split("\n").slice(0, 40).join("\n");
      return `--- ${rel} ---\n${snippet}`;
    })
    .join("\n\n");
}
