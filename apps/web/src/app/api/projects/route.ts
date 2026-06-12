import { analyzeProject } from "@frontend-logic/analyzer";
import type { ProjectConfig } from "@frontend-logic/shared";
import { saveIndex } from "@/lib/index-store";
import {
  addStoredProject,
  clonedReposDir,
  generateProjectId,
  withProjectStoreLock
} from "@/lib/project-store";
import { configuredProjects } from "@/lib/projects";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    projects: configuredProjects()
  });
}

type AddProjectBody = {
  name?: string;
  rootPath?: string;
  gitUrl?: string;
  branch?: string;
  description?: string;
};

const CLONE_TIMEOUT_MS = 120_000;

export async function POST(req: Request) {
  const body = (await req.json()) as AddProjectBody;
  const name = body.name?.trim();
  const rootPath = body.rootPath?.trim();
  const gitUrl = body.gitUrl?.trim();
  const branch = body.branch?.trim() || undefined;

  if (!name) {
    return NextResponse.json({ error: "项目名称必填" }, { status: 400 });
  }
  if (!rootPath && !gitUrl) {
    return NextResponse.json({ error: "本地路径和 git 地址至少填写一个" }, { status: 400 });
  }
  if (rootPath && gitUrl) {
    return NextResponse.json({ error: "本地路径和 git 地址只能二选一" }, { status: 400 });
  }

  if (rootPath) {
    if (!isExistingDirectory(rootPath)) {
      return NextResponse.json({ error: `本地路径不存在或不是目录：${rootPath}` }, { status: 400 });
    }
    if (!isAllowedLocalRoot(rootPath)) {
      return NextResponse.json(
        { error: "本地路径不在允许范围内（FRONTEND_ASSISTANT_ALLOWED_ROOTS）" },
        { status: 403 }
      );
    }
  } else if (!isSafeGitUrl(gitUrl!)) {
    return NextResponse.json(
      { error: "git 地址格式不合法，仅支持 https:// 或 git@ 开头" },
      { status: 400 }
    );
  }

  // 整个添加流程串行化：避免并发请求生成重复 id 或互相覆盖配置
  return withProjectStoreLock(async () => {
    const taken = new Set(configuredProjects().map((item) => item.id));
    const id = generateProjectId(name, taken);

    let resolvedRoot: string;
    if (rootPath) {
      resolvedRoot = rootPath;
    } else {
      const target = path.join(clonedReposDir(), id);
      try {
        await cloneRepo(gitUrl!, target, branch);
      } catch (err) {
        // clone 失败/超时后清掉半成品目录，避免下次同名添加因目录非空而失败
        await rm(target, { recursive: true, force: true });
        return NextResponse.json(
          { error: `git clone 失败：${err instanceof Error ? err.message : String(err)}` },
          { status: 502 }
        );
      }
      resolvedRoot = target;
    }

    const project: ProjectConfig = {
      id,
      name,
      rootPath: resolvedRoot,
      branch,
      description: body.description?.trim() || undefined,
      gitUrl: gitUrl || undefined,
      source: "stored"
    };

    try {
      addStoredProject(project);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "项目写入失败" },
        { status: 409 }
      );
    }

    // 索引构建失败不影响项目添加结果，返回 indexError 让前端提示手动刷新
    let indexSummary: { generatedAt: string; files: number; facts: number } | undefined;
    let indexError: string | undefined;
    try {
      const index = await analyzeProject(project);
      await saveIndex(index);
      indexSummary = {
        generatedAt: index.generatedAt,
        files: index.files.length,
        facts: index.facts.length
      };
    } catch (err) {
      indexError = err instanceof Error ? err.message : String(err);
    }

    return NextResponse.json({ project, index: indexSummary, indexError });
  });
}

function isExistingDirectory(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 本地路径白名单：FRONTEND_ASSISTANT_ALLOWED_ROOTS 配置逗号分隔的根目录列表，
 * 配置后 rootPath 必须落在其中之一内；未配置时保持开放（向后兼容）。
 */
function isAllowedLocalRoot(target: string): boolean {
  const raw = process.env.FRONTEND_ASSISTANT_ALLOWED_ROOTS;
  if (!raw) return true;
  const roots = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (roots.length === 0) return true;
  return roots.some((root) => isWithin(root, target));
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** 仅允许 https:// 或 git@ 形式，且不允许以 - 开头，防止被解析成 git 参数 */
function isSafeGitUrl(url: string): boolean {
  if (url.startsWith("-")) return false;
  return /^https:\/\/[\w.-]+\//.test(url) || /^git@[\w.-]+:/.test(url);
}

function cloneRepo(gitUrl: string, target: string, branch?: string): Promise<void> {
  mkdirSync(path.dirname(target), { recursive: true });
  const args = ["clone", "--depth", "1"];
  if (branch) args.push("--branch", branch);
  args.push("--", gitUrl, target);

  return new Promise((resolve, reject) => {
    // spawn 数组传参不经过 shell；GIT_TERMINAL_PROMPT=0 禁止交互式输密码导致挂起
    const child = spawn("git", args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`clone 超时（${CLONE_TIMEOUT_MS / 1000}s）`));
    }, CLONE_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").pop() || `git exit code ${code}`));
    });
  });
}
