"use client";

import type { LogicAnswer, ProjectConfig } from "@frontend-logic/shared";
import {
  Activity,
  Brain,
  Braces,
  ChevronDown,
  Code2,
  DatabaseZap,
  FileCode2,
  FolderGit2,
  ListChecks,
  MonitorPlay,
  Loader2,
  RefreshCcw,
  ScanSearch,
  Search,
  Sparkles,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

type IndexStatus = {
  generatedAt?: string;
  files?: number;
  facts?: number;
};

const DEFAULT_EXAMPLES = [
  "导出按钮什么时候显示？",
  "手机号为什么有时候看不到？",
  "订单列表调用了哪些接口？"
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
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects]
  );

  const isGateway = answer?.mode === "gateway";

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

  async function ask() {
    if (!projectId || !question.trim()) return;
    setAsking(true);
    setError("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, question })
      });
      if (!res.ok) throw new Error(await res.text());
      setAnswer(await res.json());
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

          {answer ? (
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
                    {(answer.trace?.mode ?? answer.mode) === "gateway"
                      ? `AI Gateway${answer.trace?.model ? ` · ${answer.trace.model}` : ""}`
                      : "本地推理引擎"}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  className={`trace-chevron${traceOpen ? " open" : ""}`}
                />
              </button>

              {traceOpen ? (
                <div className="trace-body">
                  {answer.trace ? (
                    <div className="trace-overview">
                      <span className="trace-stat">
                        <ScanSearch size={13} />
                        命中 {answer.trace.matchedFacts} / 共 {answer.trace.totalFacts} 条事实
                      </span>
                      <span className="trace-stat">
                        <Code2 size={13} />
                        采用 {answer.trace.usedFacts} 条
                      </span>
                      {answer.trace.queryTerms.length > 0 ? (
                        <div className="trace-terms">
                          <span className="trace-terms-label">查询词</span>
                          {answer.trace.queryTerms.slice(0, 12).map((term) => (
                            <span key={term} className="term-chip">
                              {term}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {answer.usedFacts.length > 0 ? (
                    <div className="trace-section">
                      <h4 className="trace-section-title">用到的逻辑事实</h4>
                      <ul className="fact-list">
                        {answer.usedFacts.slice(0, 8).map((fact) => (
                          <li key={fact.id} className="fact-item">
                            <span className="fact-type">{fact.type}</span>
                            <span className="fact-loc">
                              {fact.filePath}:{fact.line}
                            </span>
                            {fact.targetText ?? fact.expression ? (
                              <span className="fact-expr">{fact.targetText ?? fact.expression}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {answer.evidence.length > 0 ? (
                    <div className="trace-section">
                      <h4 className="trace-section-title">代码证据</h4>
                      <div className="evidence-list">
                        {answer.evidence.slice(0, 5).map((item, idx) => (
                          <div key={`${item.filePath}:${item.line}:${idx}`} className="evidence-item">
                            <div className="evidence-meta">
                              {item.filePath}:{item.line}
                            </div>
                            <pre className="code-block">{item.snippet}</pre>
                          </div>
                        ))}
                      </div>
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
                  <>
                    <p className="answer-conclusion">{answer.conclusion}</p>
                    {answer.sections.map((section) => (
                      <div className="section" key={section.title}>
                        <h4 className="section-title">
                          <ListChecks size={13} />
                          {section.title}
                        </h4>
                        <ul>
                          {section.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {answer.relatedFiles.length > 0 ? (
                      <div className="section">
                        <h4 className="section-title">
                          <FileCode2 size={13} />
                          涉及文件
                        </h4>
                        <div className="file-list">
                          {answer.relatedFiles.map((file) => (
                            <span key={file} className="file-chip">
                              <FileCode2 size={12} />
                              {file}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
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
                {answer?.previewHtml ? (
                  <span className="badge" data-level="high">
                    AI Generated
                  </span>
                ) : null}
              </div>
              <div className="preview-body">
                {answer?.previewHtml ? (
                  <iframe
                    srcDoc={answer.previewHtml}
                    className="preview-frame"
                    title="Page Preview"
                    sandbox="allow-scripts"
                  />
                ) : (
                  <div className="empty-state">
                    <div className="empty-inner">
                      <div className="empty-icon" data-tone="amber">
                        <MonitorPlay size={24} />
                      </div>
                      开启 AI Gateway 并提问后，这里将实时渲染代码对应的组件高保真预览。
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
