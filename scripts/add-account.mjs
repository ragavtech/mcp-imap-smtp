#!/usr/bin/env node
// Adds a mailbox to .env by asking questions, so you never have to work out
// variable naming yourself.
//
//   npm run add-account

import { stdin, stdout } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ask, askHidden, confirm } from "./prompt.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  banner, step, say, hint, ok, warn, blank, field, question, answered,
  bold, dim, cyan,
} from "./ui.mjs";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const envPath = path.join(projectDir, ".env");

function finish(code) {
  process.exit(code);
}

function toPrefix(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_";
}

function readEnv() {
  if (existsSync(envPath)) return readFileSync(envPath, "utf8");
  // Deliberately not copying .env.example: its placeholder values would look
  // like a configured account and send the first connection attempt to a
  // domain that does not exist.
  const header =
    "# Created by 'npm run add-account'. Never commit this file.\n" +
    "# See .env.example for every available setting.\n";
  writeFileSync(envPath, header, { mode: 0o600 });
  ok("Created .env");
  return header;
}

if (!process.env.MCP_GUIDED) banner("Add a mailbox", "mcp-imap-smtp");

let env = readEnv();
const hasDefault = /^IMAP_HOST=.+/m.test(env);
const existing = (env.match(/^ACCOUNTS=(.*)$/m)?.[1] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (hasDefault) existing.push("default");

/** Turns free text into a clean connector name. */
function tidyName(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const TOTAL = 4;

// 1. Address, asked first so the rest can be suggested from it.
const email = ask(
  question(1, TOTAL, "Email address", "Example: you@yourdomain.com")
);
if (!email.includes("@")) {
  blank();
  warn("That does not look like an email address.");
  finish(1);
}

// 2. Name, suggested from the address.
const suggested = tidyName(email.split("@")[0]) || "mail";
let name = tidyName(
  ask(
    question(
      2,
      TOTAL,
      "Name for this mailbox",
      `Press Enter to use "${suggested}". Or type a different name.`
    )
  )
);
if (!name) name = suggested;
if (name !== suggested) answered(`named "${name}"`);

if (existing.includes(name)) {
  blank();
  warn(`'${name}' already exists. Run 'npm start' again and choose another name.`);
  finish(1);
}

// 3. Mail server. For a domain on its own hosting, which is what this project
// is for, it is the domain with "mail." in front.
const guessedHost = "mail." + email.split("@")[1];
let host = ask(
  question(
    3,
    TOTAL,
    "Mail server",
    `Press Enter to use "${guessedHost}". Or type a different address.`
  )
);
if (!host) host = guessedHost;

// 4. Password.
const password = askHidden(
  question(4, TOTAL, "Password", "You will see dots, not letters.")
);
if (!password) {
  blank();
  warn("A password is required.");
  finish(1);
}

const prefix = toPrefix(name);

// Passwords are stored base64 encoded. This is not security, it is because
// .env files cannot carry every character reliably: an unquoted '#' starts a
// comment, and quoting breaks on values containing both quote types, which
// would truncate the password silently. Plain IMAP_PASS still works if you
// prefer to hand-edit a simple one.
const encoded = Buffer.from(password, "utf8").toString("base64");

const block = [
  "",
  `# Mailbox: ${name}`,
  `${prefix}IMAP_HOST=${host}`,
  `${prefix}IMAP_PORT=993`,
  `${prefix}IMAP_SECURE=true`,
  `${prefix}IMAP_USER=${email}`,
  `${prefix}IMAP_PASS_B64=${encoded}`,
  `${prefix}SMTP_HOST=${host}`,
  `${prefix}SMTP_PORT=465`,
  `${prefix}SMTP_SECURE=true`,
  `${prefix}SMTP_USER=${email}`,
  `${prefix}SMTP_PASS_B64=${encoded}`,
  "",
].join("\n");

{
  const current = env.match(/^ACCOUNTS=(.*)$/m);
  if (current) {
    const names = current[1].split(",").map((s) => s.trim()).filter(Boolean);
    names.push(name);
    env = env.replace(/^ACCOUNTS=.*$/m, `ACCOUNTS=${names.join(",")}`);
  } else {
    env += `\nACCOUNTS=${name}\n`;
  }
}

env += block;
writeFileSync(envPath, env, { mode: 0o600 });

blank();
ok(`Saved ${bold(email)} as ${cyan(name)}`);
hint(`Its settings in .env are named ${prefix}IMAP_HOST and so on.`);
// When run as part of 'npm start', the caller handles the next steps.
if (!process.env.MCP_GUIDED) {
  blank();
  say(bold("Next"));
  hint("npm run diagnose    check it connects");
  hint("npm run setup       register it with your assistant");
}
blank();

finish(0);
