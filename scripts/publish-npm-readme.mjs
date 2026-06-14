import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const githubReadme = path.join(root, "README.md");
const npmReadme = path.join(root, "scripts", "npm-readme.md");
const backupDir = path.join(root, "tmp");
const backupReadme = path.join(backupDir, "README.github.backup.md");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function restore() {
  if (fs.existsSync(backupReadme)) {
    fs.copyFileSync(backupReadme, githubReadme);
    fs.rmSync(backupReadme, { force: true });
  }
}

process.on("exit", restore);
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});
process.on("SIGTERM", () => {
  restore();
  process.exit(143);
});

if (!fs.existsSync(npmReadme)) {
  throw new Error("scripts/npm-readme.md is required for npm publishing");
}

run("pnpm", ["build"]);
run("pnpm", ["test"]);
run("pnpm", ["typecheck"]);

fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(githubReadme, backupReadme);
fs.copyFileSync(npmReadme, githubReadme);

run("npm", ["publish", "--access", "public", "--ignore-scripts", ...process.argv.slice(2)]);
