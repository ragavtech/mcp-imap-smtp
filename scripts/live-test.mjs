#!/usr/bin/env node
/**
 * Exercises every tool against a real mailbox and writes a report.
 *
 *   npm run test:live              test the first mailbox in .env
 *   npm run test:live -- support   test a named mailbox
 *
 * Safety rules this harness follows, because it runs against a real mailbox
 * that may hold real business mail:
 *
 *   - It works only inside a folder it creates itself, and deletes only that
 *     folder. Existing folders and messages are never modified or removed.
 *   - The only address it will send to is the mailbox's own address, so no
 *     mail reaches anyone else.
 *   - It reads existing messages but never marks, moves, or deletes them.
 *   - It stops on the first authentication failure rather than retrying,
 *     because shared hosts block an IP after a few and retrying makes it
 *     worse.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfigFromEnv,
  listAccounts,
  diagnose,
  listMailboxes,
  createMailbox,
  renameMailbox,
  deleteMailbox,
  searchEmails,
  getEmail,
  markEmail,
  moveEmail,
  sendEmail,
  resolvePath,
  shutdown,
} from "../dist/mailClient.js";
import { confirm } from "./prompt.mjs";
import {
  banner, step, say, hint, ok, fail, warn, blank, bold, dim, cyan,
} from "./ui.mjs";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const results = [];
let currentGroup = "";

function group(name) {
  currentGroup = name;
  blank();
  say(bold(name));
}

async function check(name, fn, { skip = false, reason = "" } = {}) {
  if (skip) {
    results.push({ group: currentGroup, name, status: "skipped", detail: reason });
    say(`  ${dim("–")} ${name} ${dim("skipped: " + reason)}`);
    return null;
  }
  const started = Date.now();
  try {
    const value = await fn();
    const ms = Date.now() - started;
    results.push({ group: currentGroup, name, status: "passed", ms });
    ok(`${name} ${dim(`${ms}ms`)}`);
    return value;
  } catch (err) {
    const ms = Date.now() - started;
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ group: currentGroup, name, status: "failed", detail, ms });
    fail(`${name}`);
    hint(detail);
    return null;
  }
}

const account = process.argv[2] ?? listAccounts()[0];

banner("Live mailbox tests", "mcp-imap-smtp");

if (!account) {
  fail("No mailbox configured. Run 'npm start' first.");
  process.exit(1);
}

let config;
try {
  config = loadConfigFromEnv(account);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

say(`Mailbox:  ${bold(config.imapUser)} ${dim(`(${account})`)}`);
say(`Server:   ${dim(config.imapHost)}`);
blank();
say(bold("This test will:"));
hint("create a temporary folder, then delete it at the end");
hint(`send one email to ${config.imapUser} (itself, nobody else)`);
hint("read messages without changing them");
blank();
say(bold("This test will never:"));
hint("touch your existing folders or messages");
hint("send mail to anyone but yourself");
blank();

if (!confirm("Run the tests?", { defaultYes: true })) {
  blank();
  hint("Cancelled.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const testFolder = `MCPTest-${stamp.slice(0, 19)}`;
const renamedFolder = `${testFolder}-renamed`;
let createdFolder = null;
let sentUid = null;

// ---------------------------------------------------------------------------
step(1, 5, "Connection");
// ---------------------------------------------------------------------------

const info = await check("diagnose_mailbox", () => diagnose(config));
if (!info) {
  blank();
  fail("Could not connect, so the remaining tests cannot run.");
  hint("If this is an authentication failure, do not retry immediately:");
  hint("shared hosts block your IP after repeated failures.");
  await shutdown().catch(() => {});
  process.exit(1);
}

const folders = await check("list_mailboxes", () => listMailboxes(config));

// ---------------------------------------------------------------------------
step(2, 5, "Reading");
// ---------------------------------------------------------------------------

const searchAll = await check("search_emails, recent messages", () =>
  searchEmails(config, { mailbox: "INBOX", limit: 5 })
);

await check("search_emails, unread filter", () =>
  searchEmails(config, { mailbox: "INBOX", unseenOnly: true, limit: 5 })
);

await check("search_emails, date filter", () => {
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return searchEmails(config, { mailbox: "INBOX", since, limit: 5 });
});

await check("search_emails, subject filter", () =>
  searchEmails(config, { mailbox: "INBOX", subject: "invoice", limit: 3 })
);

await check("search_emails, empty result handled", async () => {
  const r = await searchEmails(config, {
    mailbox: "INBOX",
    subject: "zzz-no-such-subject-zzz",
    limit: 3,
  });
  if (r.count !== 0) throw new Error(`expected 0 results, got ${r.count}`);
  return r;
});

await check("search_emails, paging returns a different page", async () => {
  const first = await searchEmails(config, { mailbox: "INBOX", limit: 2, offset: 0 });
  if (first.total <= 2) return "inbox too small to page, nothing to compare";
  const second = await searchEmails(config, { mailbox: "INBOX", limit: 2, offset: 2 });
  const overlap = first.messages.some((m) =>
    second.messages.some((n) => n.uid === m.uid)
  );
  if (overlap) throw new Error("the second page repeated messages from the first");
  if (!first.hasMore) throw new Error("hasMore should be true when more remain");
  return `total ${first.total}, pages do not overlap`;
});

const firstUid = searchAll?.messages?.[0]?.uid;
const body = await check(
  "get_email, full message body",
  () => getEmail(config, "INBOX", firstUid),
  { skip: !firstUid, reason: "inbox is empty" }
);

if (body) {
  await check("get_email returned a parsed body", async () => {
    if (typeof body.text !== "string" && typeof body.subject !== "string") {
      throw new Error("no text or subject was parsed from the message");
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
step(3, 5, "Folders");
// ---------------------------------------------------------------------------

createdFolder = await check("create_mailbox", () =>
  createMailbox(config, testFolder)
);

await check(
  "new folder appears in the list",
  async () => {
    const list = await listMailboxes(config);
    const found = list.folders.some((f) =>
      f.path.toLowerCase().includes(testFolder.toLowerCase())
    );
    if (!found) throw new Error("the folder was created but is not listed");
    return true;
  },
  { skip: !createdFolder, reason: "folder was not created" }
);

await check(
  "namespace prefix applied automatically",
  async () => {
    const resolved = await resolvePath(config, testFolder);
    const expected = info.namespacePrefix.startsWith("INBOX")
      ? `INBOX.${testFolder}`
      : testFolder;
    if (resolved !== expected) {
      throw new Error(`resolved to "${resolved}", expected "${expected}"`);
    }
    return resolved;
  },
  { skip: !createdFolder, reason: "folder was not created" }
);

await check(
  "rename_mailbox",
  () => renameMailbox(config, testFolder, renamedFolder),
  { skip: !createdFolder, reason: "folder was not created" }
);

// ---------------------------------------------------------------------------
step(4, 5, "Sending");
// ---------------------------------------------------------------------------

const subject = `mcp-imap-smtp self test ${stamp}`;

const sent = await check("send_email, to this mailbox only", () =>
  sendEmail(config, {
    to: config.imapUser,
    subject,
    text:
      "Automated self test from mcp-imap-smtp.\n\n" +
      `Sent at ${new Date().toISOString()}.\n` +
      "This message was sent by the project's own test harness and can be deleted.",
  })
);

// The headline feature: most self-hosted servers do not save sent mail for you.
await check(
  "sent copy saved to the Sent folder",
  async () => {
    if (!sent) throw new Error("the message was not sent");
    if (sent.saveToSentError) throw new Error(sent.saveToSentError);
    if (!sent.savedToSent) throw new Error("no Sent folder was written to");
    return sent.savedToSent;
  },
  { skip: !sent, reason: "sending failed" }
);

await check(
  "the sent copy is findable in Sent",
  async () => {
    if (!sent?.savedToSent) throw new Error("nothing was saved");
    const found = await searchEmails(config, {
      mailbox: sent.savedToSent,
      subject: "mcp-imap-smtp self test",
      limit: 10,
    });
    const match = found.messages.find((m) => m.subject === subject);
    if (!match) throw new Error("the saved copy could not be found again");
    sentUid = match.uid;
    return `uid ${match.uid} in ${sent.savedToSent}`;
  },
  { skip: !sent?.savedToSent, reason: "nothing was saved to Sent" }
);

// ---------------------------------------------------------------------------
step(5, 5, "Message operations");
// ---------------------------------------------------------------------------

const sentFolder = sent?.savedToSent;

await check(
  "mark_email, flagged",
  () => markEmail(config, sentFolder, sentUid, "\\Flagged", true),
  { skip: !sentUid, reason: "no test message to act on" }
);

await check(
  "mark_email, unflagged",
  () => markEmail(config, sentFolder, sentUid, "\\Flagged", false),
  { skip: !sentUid, reason: "no test message to act on" }
);

await check(
  "move_email into the test folder",
  async () => {
    const moved = await moveEmail(config, sentFolder, sentUid, renamedFolder);
    const there = await searchEmails(config, {
      mailbox: renamedFolder,
      limit: 10,
    });
    if (there.count === 0) throw new Error("the message did not arrive");
    return moved;
  },
  {
    skip: !sentUid || !createdFolder,
    reason: !createdFolder ? "no test folder" : "no test message",
  }
);

// ---------------------------------------------------------------------------
// Clean up. Only the folder this run created is removed, and it takes the test
// message with it.
// ---------------------------------------------------------------------------

blank();
say(bold("Cleaning up"));

await check(
  "delete_mailbox removes only the test folder",
  () => deleteMailbox(config, renamedFolder),
  { skip: !createdFolder, reason: "nothing to clean up" }
);

await shutdown().catch(() => {});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.status === "passed").length;
const failed = results.filter((r) => r.status === "failed").length;
const skipped = results.filter((r) => r.status === "skipped").length;

blank();
step(null, null, "Results");
say(`${passed} passed, ${failed} failed, ${skipped} skipped`);
blank();

if (failed) {
  say(bold("Failures"));
  for (const r of results.filter((x) => x.status === "failed")) {
    fail(`${r.group}: ${r.name}`);
    hint(r.detail);
  }
  blank();
}

const reportDir = path.join(projectDir, "reports");
mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `live-test-${stamp.slice(0, 19)}.md`);

const lines = [
  "# Live mailbox test report",
  "",
  `- Run: ${new Date().toISOString()}`,
  `- Mailbox: ${config.imapUser} (${account})`,
  `- Server: ${config.imapHost}:${config.imapPort}`,
  `- Namespace prefix: ${info.namespacePrefix}`,
  `- Detected Sent folder: ${info.detectedSentFolder}`,
  `- Node: ${process.version}`,
  "",
  `**${passed} passed, ${failed} failed, ${skipped} skipped**`,
  "",
];

let group_ = "";
for (const r of results) {
  if (r.group !== group_) {
    group_ = r.group;
    lines.push("", `## ${group_}`, "", "| Test | Result | Detail |", "| --- | --- | --- |");
  }
  const mark =
    r.status === "passed" ? "passed" : r.status === "failed" ? "FAILED" : "skipped";
  const detail = r.detail ? r.detail.replace(/\|/g, "\\|").slice(0, 120) : r.ms ? `${r.ms}ms` : "";
  lines.push(`| ${r.name} | ${mark} | ${detail} |`);
}

lines.push(
  "",
  "## Notes",
  "",
  "This harness creates its own folder and deletes only that folder. It sends",
  "one message to the mailbox's own address and to no one else. Existing",
  "folders and messages are read but never modified.",
  ""
);

writeFileSync(reportPath, lines.join("\n"));

say(`Report written to ${cyan(path.relative(projectDir, reportPath))}`);
blank();

process.exit(failed ? 1 : 0);
