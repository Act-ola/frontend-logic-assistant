# Frontend Logic Assistant

一个面向产品和测试的 React 前端逻辑问答平台。它优先使用代码证据回答问题，而不是让模型直接猜业务。

## 技术栈

- Next.js 16 App Router + React 19
- Tailwind CSS 4
- npm workspaces monorepo
- Babel parser/traverse 做 JS/JSX AST 分析
- AI SDK 6 作为可选企业级 LLM 接入层
- 本地 evidence-first 回答器作为无密钥兜底

## 已实现的 MVP 能力

- 扫描 React JS/JSX 仓库
- 抽取 JSX 条件渲染、disabled/readOnly/hidden 属性逻辑
- 抽取接口调用、useState、Context、MobX 线索
- 基于问题检索相关逻辑事实
- 生成带代码证据、置信度、涉及文件的回答
- 提供内部工作台 UI

## 启动

```bash
nvm use
npm install
npm run analyze:demo
npm run dev
```

打开 `http://localhost:3000`，可以直接用内置 demo 项目提问：

```text
导出按钮什么时候显示？
手机号为什么有时候看不到？
订单列表调用了哪些接口？
```

> 当前项目按 Next.js 16 / React 19 构建，建议使用 Node 22。`.nvmrc` 已固定到本机验证过的版本。

## 接入真实项目

复制 `.env.example` 为 `.env.local`，配置真实仓库：

```bash
FRONTEND_ASSISTANT_PROJECTS='[{"id":"crm-web","name":"CRM Web","rootPath":"/Users/you/work/crm-web","branch":"main","description":"CRM 前端"}]'
```

为了安全，索引器默认忽略 `node_modules`、构建产物、覆盖率目录和环境文件。

## 企业级演进路线

1. 接入公司 SSO 和项目权限。
2. 将 `.logic-assistant` 本地索引迁移到 Postgres + pgvector/OpenSearch。
3. 通过 Git webhook 做增量索引。
4. 增加 alias、路由、store、API schema 的深度解析。
5. 将低置信度问题自动转给项目 owner 审核。
