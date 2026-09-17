#!/usr/bin/env node
// Shows every mailbox in .env and whether it is registered with an assistant.
//
//   npm run mailboxes

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectAccounts } from "../dist/mailClient.js";
import { detectClients } from "./clients.mjs";
import { banner, say, hint, ok, fail, blank, bold, dim, cyan, row } from "./ui.mjs";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const serverPath = path.join(projectDir, "dist", "index.js");

banner("Your mailboxes", "mcp-imap-smtp");

const accounts = inspectAccounts();

if (accounts.length === 0) {
  hint("No mailboxes configured yet.");
  blank();
  say("Run " + bold("npm start") + " to add one.");
  blank();
  process.exit(0);
}

/** Which mailbox names each installed assistant currently has registered. */
function registeredNames() {
  const byClient = new Map();
  for (const client of detectClients()) {
    if (!existsSync(client.configPath)) continue;
    let config;
    try {
      config = JSON.parse(readFileSync(client.configPath, "utf8"));
    } catch {
      continue;
    }
    const names = new Set();
    for (const entry of Object.values(config.mcpServers ?? {})) {
      const args = entry?.args ?? [];
      const target = String(args[0] ?? "");
      if (target === serverPath || target.endsWith("mcp-imap-smtp/dist/index.js")) {
        const account = entry?.env?.ACCOUNT;
        if (account) names.add(account);
      }
    }
    if (names.size) byClient.set(client.name, names);
  }
  return byClient;
}

const registered = registeredNames();

say(bold("Configured"));
blank();
for (const account of accounts) {
  const where = [];
  for (const [clientName, names] of registered) {
    if (names.has(account.name)) where.push(clientName);
  }
  const status = account.complete
    ? where.length
      ? dim("registered with " + where.join(", "))
      : dim("not registered with an assistant")
    : dim("incomplete: missing " + account.missing.join(", "));

  row(account.name, `${account.user ?? "(no address)"}  ${status}`, account.complete ? "✓" : "✗");
}

blank();
say(dim(`${accounts.length} mailbox${accounts.length === 1 ? "" : "es"} in .env`));
blank();
say(bold("Manage"));
hint("npm start          add another mailbox");
hint("npm run remove     remove a mailbox");
hint("npm run diagnose   test that they connect");
blank();
