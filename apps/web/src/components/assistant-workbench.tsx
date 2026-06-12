"use client";

import type {
  AnswerTrace,
  AskStreamEvent,
  LogicAnswer,
  PreviewBundle,
  ProjectConfig
} from "@frontend-logic/shared";
import {
  Activity,
  Brain,
  Braces,
  ChevronDown,
  Code2,
  DatabaseZap,
  FolderGit2,
  MonitorPlay,
  Loader2,
  RefreshCcw,
  ScanSearch,
  Search,
  Sparkles,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";

// Sandpack 较重且依赖浏览器环境，仅在客户端动态加载
const PreviewSandbox = dynamic(
  () => import("./sandpack-preview").then((mod) => mod.PreviewSandbox),
  {
    ssr: false,
    loading: () => <div className="preview-loading">正在加载渲染器…</div>
  }
);

type IndexStatus = {
  generatedAt?: string;
  files?: number;
  facts?: number;
};

const DEFAULT_EXAMPLES = [
  "导出按钮什么时候显示？",
  "手机号为什么有时候看不到？",
  "哪些订单不会显示在列表里？"
];

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

export function AssistantWorkbench() {
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [projectId, setProjectId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<LogicAnswer | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [examples, setExamples] = useState<string[]>(DEFAULT_EXAMPLES);
  const [traceOpen, setTraceOpen] = useState(false);
  const [reasoning, setReasoning] = useState("");
  const [liveTrace, setLiveTrace] = useState<AnswerTrace | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [previewBundle, setPreviewBundle] = useState<PreviewBundle | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [sandpackKey, setSandpackKey] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects]
  );

  const isGateway = answer?.mode === "gateway";

  // 调用详情面板：answer 到达后用完整的最终 trace（含耗时），流式期间用实时下发的 liveTrace
  const panelTrace = answer?.trace ?? liveTrace;
  const panelMode = answer?.trace?.mode ?? liveTrace?.mode ?? answer?.mode ?? "local";
  const panelModel = answer?.trace?.model ?? liveTrace?.model;
  const showTracePanel = Boolean(answer || asking || reasoning);
  const isThinking = asking && !answer;

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data: { projects: ProjectConfig[] }) => {
        setProjects(data.projects);
        setProjectId(data.projects[0]?.id ?? "");
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingProjects(false));
  }, []);

  const loadSuggestions = useCallback(async (id: string): Promise<string[]> => {
    try {
      const res = await fetch(`/api/suggestions?projectId=${encodeURIComponent(id)}`);
      const data = (res.ok ? await res.json() : { suggestions: [] }) as { suggestions?: string[] };
      return data.suggestions && data.suggestions.length > 0 ? data.suggestions : DEFAULT_EXAMPLES;
    } catch {
      return DEFAULT_EXAMPLES;
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    loadSuggestions(projectId).then((list) => {
      if (!cancelled) setExamples(list);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, loadSuggestions]);

  async function refreshIndex() {
    if (!projectId) return;
    setIndexing(true);
    setError("");
    try {
      const res = await fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
      if (!res.ok) throw new Error(await res.text());
      setIndexStatus(await res.json());
      // 索引重建后同步刷新推荐语，确保和最新代码/目录一致
      setExamples(await loadSuggestions(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "索引失败");
    } finally {
      setIndexing(false);
    }
  }

  // answer 到达后，请求 /api/preview-bundle 并用 Sandpack 真实渲染对应组件
  useEffect(() => {
    if (!answer || !projectId) {
      setPreviewBundle(null);
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }
    const entry =
      answer.relatedFiles.find((file) => /\.(jsx|tsx)$/.test(file)) ?? answer.relatedFiles[0];
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewBundle(null);
    fetch("/api/preview-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, entry })
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return (await res.json()) as PreviewBundle;
      })
      .then((bundle) => {
        if (!cancelled) setPreviewBundle(bundle);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : "预览生成失败");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [answer, projectId, reloadKey]);

  // 预览构建失败（如依赖拉取偶发失败）时，手动重来一遍：重置 Sandpack 并重新请求 bundle
  function reloadPreview() {
    setSandpackKey((key) => key + 1);
    setReloadKey((key) => key + 1);
  }

  async function ask() {
    if (!projectId || !question.trim()) return;
    setAsking(true);
    setError("");
    setAnswer(null);
    setReasoning("");
    setLiveTrace(null);
    setTraceOpen(true);

    const handleEvent = (event: AskStreamEvent) => {
      if (event.type === "trace") {
        setLiveTrace(event.trace);
      } else if (event.type === "reasoning") {
        setReasoning((prev) => prev + event.delta);
      } else if (event.type === "answer") {
        setAnswer(event.answer);
      } else if (event.type === "error") {
        setError(event.message);
      }
    };

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, question })
      });
      if (!res.ok || !res.body) {
        throw new Error(res.ok ? "响应为空" : await res.text());
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const tryHandle = (line: string) => {
        try {
          handleEvent(JSON.parse(line) as AskStreamEvent);
        } catch {
          // 半行或解析失败，忽略该行
        }
      };

      const drain = (flush: boolean) => {
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) tryHandle(line);
        }
        if (flush) {
          const tail = buffer.trim();
          if (tail) tryHandle(tail);
          buffer = "";
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        drain(false);
      }
      drain(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "问答失败");
    } finally {
      setAsking(false);
    }
  }

  function handleQueryKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 触发查询，Shift+Enter 换行；输入法组合（IME）确认时不触发
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!asking && projectId) ask();
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Brain size={19} />
          </div>
          <div>
            <h1 className="brand-title">Logic Assistant</h1>
            <p className="brand-subtitle">React Evidence Workbench</p>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">
            <span>项目</span>
            <span className="sidebar-count">{loadingProjects ? "…" : projects.length}</span>
          </div>

          <div className="project-list">
            {loadingProjects ? (
              <div className="mode-row">
                <Loader2 size={14} className="animate-spin" />
                正在加载项目
              </div>
            ) : projects.length === 0 ? (
              <div className="mode-row">暂无可用项目</div>
            ) : (
              projects.map((project) => (
                <button
                  key={project.id}
                  className="project-button"
                  data-active={project.id === projectId}
                  onClick={() => {
                    setProjectId(project.id);
                    setAnswer(null);
                    setIndexStatus(null);
                  }}
                >
                  <span className="project-name">
                    <FolderGit2 size={15} />
                    {project.name}
                  </span>
                  <span className="project-path">{project.rootPath}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="mode-row">
            <span className="mode-dot" />
            {isGateway ? "AI Gateway 已接入" : "本地推理引擎就绪"}
          </div>
          {indexStatus?.facts != null ? (
            <div className="mode-row">
              <Zap size={14} />
              已索引 {indexStatus.files ?? 0} 文件 · {indexStatus.facts} 条事实
            </div>
          ) : null}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-titles">
            <span className="eyebrow">Enterprise React Logic Q&amp;A</span>
            <h2 className="page-title">逻辑问答工作台</h2>
          </div>
          <div className="status-strip">
            <span className="pill" data-accent="mint">
              <Braces size={14} />
              Babel AST
            </span>
            <span className="pill">
              <DatabaseZap size={14} />
              Evidence-first
            </span>
            <span className="pill" data-accent={isGateway ? "blue" : "mint"}>
              <Sparkles size={14} />
              {isGateway ? "AI Gateway" : "Local fallback"}
            </span>
          </div>
        </header>

        <div className="content">
          <div className="intro">
            <h3 className="intro-heading">
              把前端代码<span className="accent-text">讲成人话</span>
            </h3>
            <p className="page-copy">
              面向产品和测试的代码证据问答台。先扫描 React 仓库里的 JSX 条件、接口调用、Context、MobX 和
              state，再给出可追溯的逻辑解释。
              {activeProject ? <> 当前项目：{activeProject.name}。</> : null}
            </p>
          </div>

          <div className="query-card">
            <div className="query-row">
              <textarea
                className="query-input"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleQueryKeyDown}
                placeholder="例如：导出按钮什么时候显示？（Enter 查询，Shift+Enter 换行）"
              />
              <div className="query-actions">
                <button className="btn btn-primary" onClick={ask} disabled={asking || !projectId}>
                  {asking ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                  查询逻辑
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={refreshIndex}
                  disabled={indexing || !projectId}
                >
                  {indexing ? <Loader2 size={17} className="animate-spin" /> : <RefreshCcw size={17} />}
                  刷新索引
                </button>
              </div>
            </div>
            <div className="examples">
              <span className="examples-label">试试：</span>
              {examples.map((example) => (
                <button key={example} className="chip" onClick={() => setQuestion(example)}>
                  {example}
                </button>
              ))}
              <span className="query-hint">
                <kbd>Enter</kbd> 查询 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行
              </span>
            </div>
          </div>

          {showTracePanel ? (
            <div className="trace-card">
              <button
                type="button"
                className="trace-head"
                onClick={() => setTraceOpen((open) => !open)}
                aria-expanded={traceOpen}
              >
                <span className="trace-head-title">
                  <Activity size={16} />
                  调用详情
                  <span className="trace-mode">
                    {panelMode === "gateway"
                      ? `AI Gateway${panelModel ? ` · ${panelModel}` : ""}`
                      : "本地推理引擎"}
                  </span>
                  {isThinking ? <span className="trace-live">实时思考中</span> : null}
                </span>
                <ChevronDown
                  size={16}
                  className={`trace-chevron${traceOpen ? " open" : ""}`}
                />
              </button>

              {traceOpen ? (
                <div className="trace-body">
                  <div className="trace-section trace-reasoning-section">
                    <h4 className="trace-section-title">
                      <Brain size={13} />
                      思考过程
                    </h4>
                    {reasoning ? (
                      <div className="trace-reasoning">
                        {reasoning}
                        {isThinking ? <span className="reasoning-caret" /> : null}
                      </div>
                    ) : (
                      <div className="trace-reasoning trace-reasoning--empty">
                        {isThinking ? "正在连接模型，准备思考…" : "暂无思考过程"}
                      </div>
                    )}
                  </div>

                  {panelTrace ? (
                    <div className="trace-overview">
                      <span className="trace-stat">
                        <ScanSearch size={13} />
                        命中 {panelTrace.matchedFacts} / 共 {panelTrace.totalFacts} 条事实
                      </span>
                      <span className="trace-stat">
                        <Code2 size={13} />
                        采用 {panelTrace.usedFacts} 条
                      </span>
                      {panelTrace.durationMs != null ? (
                        <span className="trace-stat">
                          <Activity size={13} />
                          耗时 {(panelTrace.durationMs / 1000).toFixed(1)}s
                        </span>
                      ) : null}
                      {panelTrace.queryTerms.length > 0 ? (
                        <div className="trace-terms">
                          <span className="trace-terms-label">查询词</span>
                          {panelTrace.queryTerms.slice(0, 12).map((term) => (
                            <span key={term} className="term-chip">
                              {term}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="alert">
              <Zap size={15} />
              {error}
            </div>
          ) : null}

          <div className="results-grid">
            <section className="card">
              <div className="card-header">
                <div className="card-title">
                  <Code2 size={17} />
                  回答
                </div>
                <span className="badge" data-level={answer?.confidence ?? undefined}>
                  置信度 {answer ? CONFIDENCE_LABEL[answer.confidence] ?? answer.confidence : "待查询"}
                </span>
              </div>
              <div className="card-body">
                {answer ? (
                  <p className="answer-conclusion">{answer.conclusion}</p>
                ) : isThinking ? (
                  <div className="empty-state">
                    <div className="empty-inner">
                      <div className="empty-icon">
                        <Loader2 size={24} className="animate-spin" />
                      </div>
                      正在分析代码证据并生成结论，可展开上方「调用详情」实时查看 AI 思考过程。
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-inner">
                      <div className="empty-icon">
                        <Search size={24} />
                      </div>
                      选择项目后直接提问。首次查询会自动生成索引，也可以先手动刷新索引。
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="card preview-card">
              <div className="card-header">
                <div className="card-title">
                  <MonitorPlay size={17} />
                  页面预览
                </div>
                <div className="preview-actions">
                  {previewBundle ? (
                    <span className="badge" data-level="high">
                      Live Render · {previewBundle.entryComponent}
                    </span>
                  ) : null}
                  {answer ? (
                    <button
                      type="button"
                      className="preview-refresh"
                      onClick={reloadPreview}
                      disabled={previewLoading}
                      title="重新生成预览"
                    >
                      <RefreshCcw size={14} className={previewLoading ? "animate-spin" : ""} />
                      重试
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="preview-body">
                {previewLoading ? (
                  <div className="empty-state">
                    <div className="empty-inner">
                      <div className="empty-icon">
                        <Loader2 size={24} className="animate-spin" />
                      </div>
                      正在收集组件依赖并构建真实渲染环境…
                    </div>
                  </div>
                ) : previewBundle ? (
                  <PreviewSandbox key={sandpackKey} bundle={previewBundle} />
                ) : previewError ? (
                  <div className="empty-state">
                    <div className="empty-inner">
                      <div className="empty-icon" data-tone="amber">
                        <MonitorPlay size={24} />
                      </div>
                      预览构建失败：{previewError}
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-inner">
                      <div className="empty-icon" data-tone="amber">
                        <MonitorPlay size={24} />
                      </div>
                      提问后，这里会收集组件源码与依赖，用 Sandpack 在浏览器内真实渲染对应页面。
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
