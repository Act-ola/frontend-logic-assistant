"use client";

import type { LogicAnswer, ProjectConfig } from "@frontend-logic/shared";
import {
  Brain,
  Braces,
  CheckCircle2,
  Code2,
  DatabaseZap,
  MonitorPlay,
  Loader2,
  RefreshCcw,
  Search
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type IndexStatus = {
  generatedAt?: string;
  files?: number;
  facts?: number;
};

const EXAMPLES = [
  "导出按钮什么时候显示？",
  "手机号为什么有时候看不到？",
  "订单列表调用了哪些接口？"
];

export function AssistantWorkbench() {
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [projectId, setProjectId] = useState("");
  const [question, setQuestion] = useState(EXAMPLES[0]);
  const [answer, setAnswer] = useState<LogicAnswer | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects]
  );

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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Brain size={19} />
          </div>
          <div>
            <h1 className="brand-title">Logic Assistant</h1>
            <p className="brand-subtitle">React evidence workbench</p>
          </div>
        </div>

        <div className="project-list">
          {loadingProjects ? (
            <div className="pill">
              <Loader2 size={14} className="animate-spin" />
              Loading projects
            </div>
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
                <span className="project-name">{project.name}</span>
                <span className="project-path">{project.rootPath}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="workspace">
        <div className="topbar">
          <div>
            <div className="eyebrow">Enterprise React Logic Q&A</div>
            <h2 className="page-title">把前端代码讲成人话</h2>
            <p className="page-copy">
              面向产品和测试的代码证据问答台。它先扫描 React 仓库里的 JSX 条件、接口调用、Context、MobX 和
              state，再给出可追溯的逻辑解释。
            </p>
          </div>
          <div className="status-strip">
            <span className="pill">
              <Braces size={14} />
              Babel AST
            </span>
            <span className="pill">
              <DatabaseZap size={14} />
              Evidence-first
            </span>
            <span className="pill">
              <CheckCircle2 size={14} />
              {answer?.mode === "gateway" ? "AI Gateway" : "Local fallback"}
            </span>
          </div>
        </div>

        <div className="query-band">
          <textarea
            className="query-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：导出按钮什么时候显示？"
          />
          <div className="grid gap-2">
            <button className="primary-button" onClick={ask} disabled={asking || !projectId}>
              {asking ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
              查询逻辑
            </button>
            <button className="secondary-button" onClick={refreshIndex} disabled={indexing || !projectId}>
              {indexing ? <Loader2 size={17} className="animate-spin" /> : <RefreshCcw size={17} />}
              刷新索引
            </button>
          </div>
        </div>

        <div className="file-list mb-4">
          {EXAMPLES.map((example) => (
            <button key={example} className="file-chip" onClick={() => setQuestion(example)}>
              {example}
            </button>
          ))}
        </div>

        {error ? <div className="pill mb-4 text-[var(--danger)]">{error}</div> : null}

        <div className="content-grid">
          <section className="surface">
            <div className="surface-header">
              <div className="surface-title">
                <Code2 size={17} />
                回答
              </div>
              <span className="pill">置信度：{answer?.confidence ?? "待查询"}</span>
            </div>
            <div className="surface-body">
              {answer ? (
                <>
                  <p className="answer-conclusion">{answer.conclusion}</p>
                  {answer.sections.map((section) => (
                    <div className="section" key={section.title}>
                      <h3>{section.title}</h3>
                      <ul>
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="section">
                    <h3>涉及文件</h3>
                    <div className="file-list">
                      {answer.relatedFiles.map((file) => (
                        <span key={file} className="file-chip">
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <div>
                    <Search size={28} className="mx-auto mb-3 text-[var(--accent)]" />
                    选择项目后直接提问。首次查询会自动生成索引，也可以先手动刷新索引。
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="surface flex flex-col min-h-[400px]">
            <div className="surface-header">
              <div className="surface-title">
                <MonitorPlay size={17} />
                页面预览
              </div>
              {answer?.previewHtml && (
                <span className="pill text-[var(--accent)] border-[var(--accent)]/20">
                  AI Generated
                </span>
              )}
            </div>
            <div className="surface-body p-0 relative flex-1 overflow-hidden" style={{ minHeight: "400px" }}>
              {answer?.previewHtml ? (
                <iframe
                  srcDoc={answer.previewHtml}
                  className="w-full h-full border-0 absolute inset-0"
                  title="Page Preview"
                  sandbox="allow-scripts"
                />
              ) : (
                <div className="empty-state flex flex-col h-full items-center justify-center">
                  <div>
                    <MonitorPlay size={28} className="mx-auto mb-3 text-[var(--accent-amber)]" />
                    开启 AI Gateway 并提问后，这里将实时渲染代码对应的组件高保真预览。
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
