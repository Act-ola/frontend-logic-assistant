import { analyzeProject, buildLocalAnswer } from "./index";
import path from "node:path";

const target = process.argv[2];

if (!target) {
  console.error("Usage: npm run analyze:demo or tsx src/cli.ts /path/to/react-repo");
  process.exit(1);
}

const rootPath = path.resolve(process.cwd(), target);
const index = await analyzeProject({
  id: "demo",
  name: "Demo React Project",
  rootPath
});

const answer = buildLocalAnswer(index, "导出按钮什么时候显示？");

console.log(JSON.stringify({
  project: index.project,
  files: index.files.length,
  facts: index.facts.length,
  sampleAnswer: {
    conclusion: answer.conclusion,
    confidence: answer.confidence,
    relatedFiles: answer.relatedFiles,
    sections: answer.sections
  }
}, null, 2));
