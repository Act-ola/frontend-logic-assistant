import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function workspaceRoot() {
  let current = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    const packagePath = path.join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
          workspaces?: string[];
        };
        if (packageJson.workspaces) return current;
      } catch {
        return current;
      }
    }
    current = path.dirname(current);
  }

  return process.cwd();
}
