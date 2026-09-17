#!/usr/bin/env node
// One guided command: builds if needed, asks for your mailbox, tests the
// connection, and registers it with your AI assistant.
//
//   npm start

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  banner, step, say, hint, ok, fail, warn, blank, bold, dim, cyan, green,
} from "./ui.mjs";
import { detectClients, manualSnippet } from "./clients.mjs";
import { classify, offerRecovery } from "./recovery.mjs";
import { ask, askHidden, confirm } from "./prompt.mjs";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

// The compiled module is imported lazily: dist/ may not exist on a fresh
// install, and building it is one of this script's own jobs.
let prefixFor;

async function loadMailClient() {
  if (!prefixFor) {
    ({ prefixFor } = await import("../dist/mailClient.js"));
  }
}

const line = say;
const SERVER_PATH = path.join(projectDir, "dist", "index.js");
const heading = (text) => step(null, null, text);

/**
 * This process loaded .env on startup, so those values sit in its environment.
 * dotenv does not override variables that are already set, so passing them to a
 * child would make it read stale settings after .env has been edited.
 */
function cleanEnv() {
  const clean = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(^|_)(IMAP|SMTP)_/.test(key) || key === "ACCOUNTS") continue;
    clean[key] = value;
  }
  return clean;
}

function run(command, args, opts = {}) {
  const clean = cleanEnv();
  const { extraEnv = {}, ...rest } = opts;
  return spawnSync(command, args, {
    cwd: projectDir,
    stdio: "inherit",
    shell: false,
    ...rest,
    env: { ...clean, MCP_GUIDED: "1", ...extraEnv },
  });
}

banner("mcp-imap-smtp", "Connect your mailbox to your AI assistant");

// ---------------------------------------------------------------------------
// 1. Dependencies
// ---------------------------------------------------------------------------
if (!existsSync(path.join(projectDir, "node_modules"))) {
  say(dim("Installing dependencies, this takes a moment..."));
  const r = run("npm", ["install", "--no-audit", "--no-fund"], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    fail("Dependency install failed.");
    blank();
    stdout.write(String(r.stderr || r.stdout || ""));
    process.exit(1);
  }
  ok("Dependencies installed");
}

// ---------------------------------------------------------------------------
// 2. Build
// ---------------------------------------------------------------------------
if (!existsSync(path.join(projectDir, "dist", "mailClient.js"))) {
  say(dim("Building..."));
  const r = run("npm", ["run", "build"], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    fail("Build failed.");
    blank();
    stdout.write(String(r.stderr || r.stdout || ""));
    process.exit(1);
  }
  ok("Built");
}

// ---------------------------------------------------------------------------
// 3. Mailbox credentials
// ---------------------------------------------------------------------------
await loadMailClient();

const envPath = path.join(projectDir, ".env");
let hasAccount = false;
if (existsSync(envPath)) {
  hasAccount = /^[A-Z_]*IMAP_HOST=.+/m.test(readFileSync(envPath, "utf8"));
}

/**
 * Reads the mailbox list in a fresh process.
 *
 * Re-importing the module here would not work: dotenv does not overwrite
 * variables already in the environment, so ACCOUNTS keeps whatever value it
 * had when this process started, and a mailbox added during this run stays
 * invisible. A child process starts with those variables stripped, so it sees
 * the file as it is now.
 */
function currentMailboxes() {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      "import('./dist/mailClient.js').then(m => " +
        "process.stdout.write(JSON.stringify(m.inspectAccounts())))",
    ],
    { cwd: projectDir, encoding: "utf8", env: cleanEnv() }
  );
  try {
    return JSON.parse(r.stdout || "[]");
  } catch {
    return [];
  }
}

/** Tests one mailbox, showing its output and returning the outcome. */
function testOne(name) {
  const r = run("node", ["scripts/diagnose.mjs", name], {
    stdio: ["inherit", "pipe", "pipe"],
  });
  const output = String(r.stdout || "") + String(r.stderr || "");
  stdout.write(output);
  return { ok: r.status === 0, output };
}

if (!hasAccount) {
  step(1, 3, "Add your mailbox");
  hint("You will need the email address and its password.");
  const r = run("node", ["scripts/add-account.mjs"]);
  if (r.status !== 0) process.exit(r.status ?? 1);
} else {
  const existing = currentMailboxes();
  step(1, 3, "Your mailboxes");
  for (const a of existing) ok(`${bold(a.user)}  ${dim("(" + a.name + ")")}`);
}

// Add mailboxes one at a time, testing each before offering another, so a
// mistake is caught next to the answers that caused it.
const verified = [];
const failed = [];

while (true) {
  const all = currentMailboxes();
  const untested = all.filter(
    (a) => !verified.includes(a.name) && !failed.includes(a.name)
  );

  for (const a of untested) {
    let attempts = 0;
    let settled = false;

    while (!settled) {
      step(2, 3, `Testing ${a.user}`);
      const result = testOne(a.name);

      if (result.ok) {
        verified.push(a.name);
        blank();
        ok(`${bold(a.user)} connected as ${cyan(a.name)}`);
        hint(`Mail connection '${a.name}' created successfully.`);
        settled = true;
        break;
      }

      attempts++;
      const kind = classify(result.output);
      const action = offerRecovery({
        kind,
        projectDir,
        prefix: prefixFor(a.name),
        attempts,
        ask,
        askHidden,
        confirm,
      });

      if (action === "skip") {
        failed.push(a.name);
        blank();
        hint("Left for now. Run 'npm start' again when you want to try it.");
        settled = true;
      }
      // "retry" loops round and tests again with the updated settings.
    }
  }

  blank();
  if (!confirm("Add another mailbox?", { defaultYes: false })) break;
  const r = run("node", ["scripts/add-account.mjs"]);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

step(3, 3, "Summary");
const all = currentMailboxes();
for (const a of all) {
  if (verified.includes(a.name))
    ok(`${cyan(a.name.padEnd(14))} ${bold(a.user)}  ${dim("connected")}`);
  else
    fail(`${cyan(a.name.padEnd(14))} ${bold(a.user)}  ${dim("not connected")}`);
}

if (verified.length === 0) {
  fail("No mailbox connected, so nothing will be registered.");
  hint("Fix the problems above and run 'npm start' again.");
  line("");
  process.exit(1);
}

if (failed.length) {
  warn(`${failed.length} mailbox(es) did not connect and will be skipped.`);
  line("");
}

step(3, 3, "Connect to your AI assistant");

const clients = detectClients();

if (clients.length === 0) {
  hint("No supported MCP client was detected on this machine.");
  blank();
  say(bold("Add this to your client's MCP configuration:"));
  blank();
  stdout.write(manualSnippet(SERVER_PATH, verified) + "\n");
  blank();
  hint("Any MCP client works. Only the location of this file differs.");
  blank();
  process.exit(0);
}

say("MCP clients found on this machine:");
blank();
clients.forEach((c, i) => say(`  ${cyan(String(i + 1))}  ${c.name}`));
say(`  ${cyan(String(clients.length + 1))}  Something else, show me the config to paste`);
blank();

const choice = ask(
  `Which one? ${dim(`[1-${clients.length + 1}]`)} ${cyan("\u203a")} `
);
const index = Number(choice) - 1;

if (!choice || index === clients.length || Number.isNaN(index)) {
  blank();
  say(bold("Add this to your client's MCP configuration:"));
  blank();
  stdout.write(manualSnippet(SERVER_PATH, verified) + "\n");
  blank();
  hint("Any MCP client works. Only the location of this file differs.");
  blank();
  process.exit(0);
}

const client = clients[index] ?? clients[0];

// Only mailboxes that connected are registered. Registering an untested one
// would leave a connector that fails the moment the assistant uses it.
const setup = run("bash", ["scripts/setup-claude.sh"], {
  extraEnv: {
    MCP_CLIENT_CONFIG: client.configPath,
    MCP_CLIENT_NAME: client.name,
    MCP_ACCOUNTS: verified.join(" "),
  },
});

if (setup.status === 0) {
  const names = verified.join(", ");
  banner("All done", `${names} ready`);
  say(
    `${verified.length === 1 ? "Mail connection" : "Mail connections"} ` +
      `${cyan(names)} created successfully.`
  );
  blank();
  say(bold("To finish"));
  hint(`1. Quit ${client.name} completely`);
  hint("2. Open it again");
  hint("3. Ask it to run diagnose_mailbox");
  blank();
  say(bold("Later"));
  hint("Run 'npm start' again to add more mailboxes.");
  hint("Each one appears separately, so you can tell your assistant which");
  hint("mailbox to use.");
  blank();
}

process.exit(setup.status ?? 0);
