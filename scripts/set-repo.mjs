#!/usr/bin/env node
// Sets the GitHub repository URLs in package.json.
//
//   npm run set-repo -- your-github-username
//   npm run set-repo -- your-github-username custom-repo-name

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { banner, say, hint, ok, warn, blank, bold, cyan, dim } from "./ui.mjs";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const pkgPath = path.join(projectDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const username = process.argv[2];
const repo = process.argv[3] ?? pkg.name;

banner("Set repository URLs", "mcp-imap-smtp");

if (!username) {
  warn("No username given.");
  blank();
  say("Usage:");
  hint("npm run set-repo -- your-github-username");
  hint("npm run set-repo -- your-github-username custom-repo-name");
  blank();
  say("Current values:");
  hint(`repository  ${pkg.repository?.url ?? "(not set)"}`);
  hint(`bugs        ${pkg.bugs?.url ?? "(not set)"}`);
  hint(`homepage    ${pkg.homepage ?? "(not set)"}`);
  blank();
  process.exit(1);
}

if (!/^[A-Za-z0-9-]+$/.test(username)) {
  warn("A GitHub username contains only letters, numbers and hyphens.");
  blank();
  process.exit(1);
}

const base = `https://github.com/${username}/${repo}`;
pkg.repository = { type: "git", url: `git+${base}.git` };
pkg.bugs = { url: `${base}/issues` };
pkg.homepage = `${base}#readme`;

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

ok("package.json updated");
blank();
hint(`repository  ${pkg.repository.url}`);
hint(`bugs        ${pkg.bugs.url}`);
hint(`homepage    ${pkg.homepage}`);
blank();
say(bold("Next"));
hint(`1. Create an empty repository at ${cyan(base)}`);
hint("   with no README, licence or .gitignore, since this project has them");
hint("2. Then run:");
blank();
say(dim("     git init"));
say(dim("     git add ."));
say(dim('     git commit -m "Initial release"'));
say(dim("     git branch -M main"));
say(dim(`     git remote add origin ${base}.git`));
say(dim("     git push -u origin main"));
blank();
