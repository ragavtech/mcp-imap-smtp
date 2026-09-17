/**
 * Drives the MCP server the way an assistant does: as a child process, over
 * stdio, speaking JSON-RPC.
 *
 * The harness in scripts/live-test.mjs calls the mail functions directly, so it
 * cannot catch faults in this layer. A tool can work perfectly there and still
 * fail when an assistant calls it, if a schema is wrong or an error escapes
 * instead of being returned.
 *
 * No mailbox is needed. The credentials point at a host that does not resolve,
 * so every call fails to connect. What is being checked is that each failure
 * comes back as a well formed MCP error rather than a crash, and that the
 * server stays alive throughout. A server that dies on a bad argument would
 * take the connector down with it.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const serverPath = path.join(projectDir, "dist", "index.js");

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

/** A client that speaks just enough JSON-RPC to exercise the server. */
class Client {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.exited = null;

    this.child = spawn("node", [serverPath], {
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([k]) => !/(^|_)(IMAP|SMTP)_/.test(k) && k !== "ACCOUNTS"
          )
        ),
        IMAP_HOST: "mail.invalid-host-for-tests.example",
        IMAP_USER: "tester@example.com",
        IMAP_PASS: "not-a-real-password",
        SMTP_HOST: "mail.invalid-host-for-tests.example",
        SMTP_USER: "tester@example.com",
        SMTP_PASS: "not-a-real-password",
        IDLE_TIMEOUT_MS: "1000",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.on("exit", (code) => {
      this.exited = code;
      for (const { reject } of this.pending.values()) {
        reject(new Error(`server exited with code ${code}`));
      }
      this.pending.clear();
    });

    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const entry = this.pending.get(message.id);
        if (entry) {
          this.pending.delete(message.id);
          entry.resolve(message);
        }
      }
    });
  }

  request(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.stdin.write(payload + "\n");
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"
    );
  }

  stop() {
    this.child.kill();
  }
}

const client = new Client();

console.log("\nMCP protocol");

// --- handshake -------------------------------------------------------------

const init = await client.request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "protocol-test", version: "1" },
});

check("server responds to initialize", !!init?.result);
check(
  "server reports a name",
  typeof init?.result?.serverInfo?.name === "string",
  JSON.stringify(init?.result?.serverInfo)
);
check(
  "server declares tool support",
  !!init?.result?.capabilities?.tools,
  JSON.stringify(init?.result?.capabilities)
);

client.notify("notifications/initialized");

// --- tool listing ----------------------------------------------------------

const listed = await client.request("tools/list");
const tools = listed?.result?.tools ?? [];
const names = tools.map((t) => t.name).sort();

const EXPECTED = [
  "create_mailbox",
  "delete_mailbox",
  "diagnose_mailbox",
  "get_email",
  "list_mailboxes",
  "mark_email",
  "move_email",
  "rename_mailbox",
  "search_emails",
  "send_email",
].sort();

check(
  `all ${EXPECTED.length} tools are advertised`,
  JSON.stringify(names) === JSON.stringify(EXPECTED),
  `got ${JSON.stringify(names)}`
);

check(
  "every tool has a description",
  tools.every((t) => typeof t.description === "string" && t.description.length > 20),
  tools.filter((t) => !t.description || t.description.length <= 20).map((t) => t.name).join(", ")
);

check(
  "every tool has an input schema",
  tools.every((t) => t.inputSchema && t.inputSchema.type === "object")
);

// An assistant relies on descriptions to choose a tool, and on required fields
// to know what it must supply.
const uid = tools.find((t) => t.name === "get_email");
check(
  "get_email requires a uid",
  (uid?.inputSchema?.required ?? []).includes("uid"),
  JSON.stringify(uid?.inputSchema?.required)
);

const send = tools.find((t) => t.name === "send_email");
check(
  "send_email requires a recipient and subject",
  ["to", "subject"].every((k) => (send?.inputSchema?.required ?? []).includes(k)),
  JSON.stringify(send?.inputSchema?.required)
);

check(
  "send_email warns that it cannot be undone",
  /undone|confirm/i.test(send?.description ?? ""),
  send?.description
);

check(
  "delete_mailbox warns that it is destructive",
  /cannot be undone|permanently/i.test(
    tools.find((t) => t.name === "delete_mailbox")?.description ?? ""
  )
);

// --- annotations -----------------------------------------------------------
//
// Annotations tell a client what a tool does before calling it. Getting these
// wrong is worse than omitting them: a client could treat a destructive tool
// as safe.

const ann = (name) => tools.find((t) => t.name === name)?.annotations ?? {};

check(
  "every tool carries annotations",
  tools.every((t) => t.annotations && typeof t.annotations.readOnlyHint === "boolean"),
  tools.filter((t) => !t.annotations).map((t) => t.name).join(", ")
);

const readOnly = ["diagnose_mailbox", "list_mailboxes", "search_emails", "get_email"];
for (const name of readOnly) {
  check(`${name} is marked read-only`, ann(name).readOnlyHint === true);
}

const writers = [
  "create_mailbox", "rename_mailbox", "delete_mailbox",
  "mark_email", "move_email", "send_email",
];
for (const name of writers) {
  check(`${name} is not marked read-only`, ann(name).readOnlyHint === false);
}

check(
  "delete_mailbox is the only tool marked destructive",
  tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name).join(",") ===
    "delete_mailbox",
  tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name).join(",")
);

check("send_email is not idempotent", ann("send_email").idempotentHint === false);
check("move_email is not idempotent", ann("move_email").idempotentHint === false);

// --- pagination ------------------------------------------------------------

const search = tools.find((t) => t.name === "search_emails");
check(
  "search_emails accepts an offset for paging",
  Object.keys(search?.inputSchema?.properties ?? {}).includes("offset")
);
check(
  "search_emails explains paging in its description",
  /offset|nextOffset|paginat/i.test(search?.description ?? "")
);

// --- calling tools ---------------------------------------------------------

console.log("\ncalling tools with a server that cannot be reached");

/** Every tool should fail cleanly rather than crashing or hanging. */
const calls = [
  ["diagnose_mailbox", {}],
  ["list_mailboxes", {}],
  ["search_emails", { mailbox: "INBOX", limit: 5 }],
  ["get_email", { mailbox: "INBOX", uid: 1 }],
  ["mark_email", { mailbox: "INBOX", uid: 1, flag: "seen", add: true }],
  ["move_email", { mailbox: "INBOX", uid: 1, targetMailbox: "Archive" }],
  ["create_mailbox", { name: "ProtocolTest" }],
  ["rename_mailbox", { oldName: "A", newName: "B" }],
  ["delete_mailbox", { name: "ProtocolTest" }],
  ["send_email", { to: "nobody@example.com", subject: "test", text: "body" }],
];

for (const [name, args] of calls) {
  let response;
  try {
    response = await client.request("tools/call", { name, arguments: args });
  } catch (err) {
    check(`${name} responds`, false, err.message);
    continue;
  }

  const hasResult = !!response?.result;
  const text = response?.result?.content?.[0]?.text ?? "";
  check(
    `${name} returns a response rather than crashing`,
    hasResult && typeof text === "string" && text.length > 0,
    JSON.stringify(response).slice(0, 160)
  );
  check(
    `${name} reports the failure as an error`,
    response?.result?.isError === true,
    `isError was ${response?.result?.isError}`
  );
}

// --- invalid input ---------------------------------------------------------

console.log("\ninvalid input is rejected, not crashed on");

const bad = [
  ["get_email with a missing uid", "get_email", { mailbox: "INBOX" }],
  ["get_email with a non-numeric uid", "get_email", { mailbox: "INBOX", uid: "abc" }],
  ["mark_email with an unknown flag", "mark_email", { mailbox: "INBOX", uid: 1, flag: "purple", add: true }],
  ["send_email with no recipient", "send_email", { subject: "x", text: "y" }],
  ["search_emails with a negative limit", "search_emails", { mailbox: "INBOX", limit: -5 }],
  ["create_mailbox with no name", "create_mailbox", {}],
];

for (const [label, name, args] of bad) {
  let response;
  try {
    response = await client.request("tools/call", { name, arguments: args });
  } catch (err) {
    check(label, false, err.message);
    continue;
  }
  const rejected =
    response?.error !== undefined || response?.result?.isError === true;
  check(label, rejected, JSON.stringify(response).slice(0, 160));
}

let unknown;
try {
  unknown = await client.request("tools/call", {
    name: "no_such_tool",
    arguments: {},
  });
  check(
    "an unknown tool name is rejected",
    unknown?.error !== undefined || unknown?.result?.isError === true,
    JSON.stringify(unknown).slice(0, 160)
  );
} catch (err) {
  check("an unknown tool name is rejected", false, err.message);
}

// --- survival --------------------------------------------------------------

console.log("\nserver health");

check("server did not exit during the tests", client.exited === null,
  `exit code ${client.exited}`);

const stillWorks = await client.request("tools/list").catch(() => null);
check(
  "server still answers after all of that",
  (stillWorks?.result?.tools ?? []).length === EXPECTED.length
);

client.stop();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
