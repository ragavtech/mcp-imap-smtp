// Guards the fresh-install path.
//
// scripts/start.mjs builds dist/ as one of its own jobs, so it must not import
// anything from dist/ at the top level. A static import there fails on a clean
// clone before the build can run, which breaks the very first thing a new user
// does.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts"
);

let pass = 0;
let fail = 0;

function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? "\n        " + detail : ""}`);
  }
}

console.log("\nfresh install safety");

for (const file of readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"))) {
  const source = readFileSync(path.join(scriptsDir, file), "utf8");

  // Strip dynamic imports, which are fine: they run after the build.
  const withoutDynamic = source.replace(/await import\([^)]*\)/g, "");
  const staticDistImport = /^\s*import\s[^;]*from\s+["'][^"']*dist\//m.test(
    withoutDynamic
  );

  const mustNotImportDist = file === "start.mjs";
  if (mustNotImportDist) {
    check(
      `${file} does not statically import dist/`,
      !staticDistImport,
      "dist/ may not exist yet; use 'await import(...)' after the build step"
    );
  }
}

// Every script should at least parse.
for (const file of readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"))) {
  const source = readFileSync(path.join(scriptsDir, file), "utf8");
  let depth = 0;
  let balanced = true;
  for (const ch of source) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0) balanced = false;
  }
  check(`${file} has balanced braces`, balanced && depth === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
