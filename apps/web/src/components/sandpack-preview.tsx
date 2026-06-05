"use client";

import type { PreviewBundle } from "@frontend-logic/shared";
import { SandpackProvider, SandpackPreview } from "@codesandbox/sandpack-react";

/**
 * 用 Sandpack 在浏览器内真实编译并渲染业务组件。
 * files 已包含自动生成的 /index.js 挂载入口（注入 Provider 默认值 + 接口 mock）。
 */
export function PreviewSandbox({ bundle }: { bundle: PreviewBundle }) {
  return (
    <SandpackProvider
      template="react"
      theme="dark"
      files={bundle.files}
      customSetup={{ dependencies: bundle.dependencies }}
      options={{ recompileMode: "delayed", recompileDelay: 400 }}
    >
      <SandpackPreview
        showOpenInCodeSandbox={false}
        showNavigator={false}
        showRefreshButton
        style={{ height: "100%", width: "100%", border: "0" }}
      />
    </SandpackProvider>
  );
}
