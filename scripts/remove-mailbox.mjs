#!/usr/bin/env node
// Removes a mailbox: its settings in .env, and its connector in any assistant
// it was registered with.
//
//   npm run remove            choose from a list
//   npm run remove -- info    remove a named mailbox

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { inspectAccounts, prefixFor } from "../dist/mailClient.js";
import { detectClients } from "./clients.mjs";
import { ask, confirm } from "./prompt.mjs";
import { readEnv, removeKey, save } from "./envfile.mjs";
import {
  banner, say, hint, ok, fail, warn, blank, bold, dim, cyan, row,
} from "./ui.mjs";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const envPath = path.join(projectDir, ".env");
const serverPath = path.join(projectDir, "dist", "index.js");

banner("Remove a mailbox", "mcp-imap-smtp");

const accounts = inspectAccounts();
if (accounts.length === 0) {
  hint("No mailboxes configured.");
  blank();
  process.exit(0);
}

// Pick the mailbox, by argument or from a list.
let target = process.argv[2];

if (!target) {
  say(bold("Which mailbox?"));
  blank();
  accounts.forEach((a, i) =>
    say(`  ${cyan(String(i + 1))}  ${bold(a.name.padEnd(14))} ${dim(a.user ?? "")}`)
  );
  blank();
  const choice = ask(`  Type a number, or press Enter to cancel ${dim(`[1-${accounts.length}]`)} ${cyan("\u203a")} `);
  if (!choice) {
    blank();
    hint("Cancelled. Nothing was changed.");
    blank();
    process.exit(0);
  }
  const index = Number(choice) - 1;
  if (Number.isNaN(index) || index < 0 || index >= accounts.length) {
    blank();
    warn("That is not one of the options. Nothing was changed.");
    blank();
    process.exit(1);
  }
  target = accounts[index].name;
}

const account = accounts.find((a) => a.name === target);
if (!account) {
  blank();
  warn(`No mailbox named '${target}'.`);
  hint("Run 'npm run mailboxes' to see what is configured.");
  blank();
  process.exit(1);
}

blank();
say(`This removes ${cyan(account.name)} (${bold(account.user ?? "unknown")}):`);
hint("  its settings in .env");
hint("  its connector in any assistant it was registered with");
blank();
hint("The mailbox itself on your mail server is not touched.");
blank();

if (!confirm(`Remove ${account.name}?`, { defaultYes: false })) {
  blank();
  hint("Cancelled. Nothing was changed.");
  blank();
  process.exit(0);
}

// 1. Remove from .env, keeping a timestamped backup.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join(os.homedir(), "Desktop", `env_backup_${stamp}.txt`);
try {
  copyFileSync(envPath, backup);
} catch {
  // A Desktop may not exist on every platform; proceed without a backup copy.
}

let env = readEnv(envPath);
const prefix = prefixFor(account.name);

const keys = [
  "IMAP_HOST", "IMAP_PORT", "IMAP_SECURE", "IMAP_USER", "IMAP_PASS", "IMAP_PASS_B64",
  "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_PASS_B64",
  "FROM_ADDRESS", "SAVE_TO_SENT", "TLS_REJECT_UNAUTHORIZED", "IDLE_TIMEOUT_MS",
];
for (const key of keys) env = removeKey(env, prefix + key);

// Drop its comment header and tidy the name out of the ACCOUNTS list.
env = env.replace(new RegExp(`^# Mailbox: ${account.name}\\n`, "m"), "");
env = env.replace(/^ACCOUNTS=(.*)$/m, (_line, list) => {
  const names = String(list)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== account.name);
  return `ACCOUNTS=${names.join(",")}`;
});
env = env.replace(/\n{3,}/g, "\n\n");

save(envPath, env);
ok(`Removed ${account.name} from .env`);

// 2. Remove its connector from every assistant that has it.
const connectorName = account.name === "default" ? "mail" : `mail-${account.name}`;
let removedFrom = [];

for (const client of detectClients()) {
  if (!existsSync(client.configPath)) continue;
  let config;
  try {
    config = JSON.parse(readFileSync(client.configPath, "utf8"));
  } catch {
    warn(`${client.name}: config is not valid JSON, left untouched.`);
    continue;
  }
  const servers = config.mcpServers ?? {};
  const doomed = Object.entries(servers).filter(([name, entry]) => {
    const target = String((entry?.args ?? [])[0] ?? "");
    const isOurs =
      target === serverPath || target.endsWith("mcp-imap-smtp/dist/index.js");
    return isOurs && (entry?.env?.ACCOUNT === account.name || name === connectorName);
  });
  if (!doomed.length) continue;

  copyFileSync(client.configPath, `${client.configPath}.backup-${stamp}`);
  for (const [name] of doomed) delete servers[name];
  if (Object.keys(servers).length === 0) delete config.mcpServers;
  writeFileSync(client.configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  removedFrom.push(client.name);
}

if (removedFrom.length) {
  ok(`Removed its connector from ${removedFrom.join(", ")}`);
  blank();
  hint(`Restart ${removedFrom.join(" and ")} to apply.`);
} else {
  hint("It was not registered with any assistant.");
}

// process.env still holds what was loaded when this script started, so the
// remaining count has to come from the file we just wrote, not from there.
const remainingNames = (env.match(/^ACCOUNTS=(.*)$/m)?.[1] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (/^IMAP_HOST=.+/m.test(env)) remainingNames.push("default");
const left = remainingNames.length;
blank();
if (left === 0) {
  say(dim("No mailboxes remain."));
  hint("Run 'npm start' to add one.");
} else {
  say(dim(`${left} mailbox${left === 1 ? "" : "es"} remaining: ${remainingNames.join(", ")}`));
}
if (existsSync(backup)) hint(`A copy of the previous .env is on your Desktop.`);
blank();
