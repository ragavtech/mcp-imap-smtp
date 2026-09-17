#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  loadConfigFromEnv,
  listMailboxes,
  createMailbox,
  renameMailbox,
  deleteMailbox,
  searchEmails,
  getEmail,
  markEmail,
  moveEmail,
  sendEmail,
  diagnose,
  shutdown,
} from "./mailClient.js";

// Which account to serve. Set ACCOUNT in the client config, or pass it as the
// first argument. Credentials themselves always come from .env.
const account = process.env.ACCOUNT ?? process.argv[2] ?? "default";
const config = loadConfigFromEnv(account);

const server = new McpServer({
  name: account === "default" ? "mcp-imap-smtp" : `mcp-imap-smtp (${account})`,
  version: "1.21.0",
});

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Annotations tell a client what a tool does before it is called: whether it
 * only reads, whether it destroys anything, and whether calling it twice is
 * the same as calling it once. A client can use these to decide what needs
 * confirming.
 */
const READS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Changes something that cannot simply be repeated. */
const WRITES_ONCE = { ...WRITES, idempotentHint: false } as const;

/** Removes data. A client should treat these with particular care. */
const DESTROYS = { ...WRITES, destructiveHint: true } as const;

server.registerTool(
  "diagnose_mailbox",
  {
    description:
      "Report how this mail server is actually configured: detected folder namespace prefix, delimiter, Sent folder, and connection settings. Run this first when setting up a new account.",
    inputSchema: {},
    annotations: READS,
  },
  async () => {
    try {
      return ok(await diagnose(config));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "list_mailboxes",
  {
    description:
      "List all folders in the account, with the detected namespace prefix and delimiter.",
    inputSchema: {},
    annotations: READS,
  },
  async () => {
    try {
      return ok(await listMailboxes(config));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "search_emails",
  {
    description:
      "Search a folder by sender, subject, unread status, or date. Returns lightweight summaries, newest first; use get_email for full content. Results are paginated: the reply carries total, hasMore and nextOffset, so pass offset to page through a large folder rather than raising limit.",
    inputSchema: {
      mailbox: z.string().default("INBOX").describe("Folder name, e.g. 'INBOX'"),
      unseenOnly: z.boolean().optional().describe("Only unread messages"),
      from: z.string().optional().describe("Filter by sender"),
      subject: z.string().optional().describe("Filter by subject text"),
      since: z
        .string()
        .optional()
        .describe("Only messages on or after this date, e.g. '2026-09-01'"),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .default(20)
        .describe("How many to return, newest first"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("How many to skip. Use nextOffset from a previous reply."),
    },
    annotations: READS,
  },
  async (params) => {
    try {
      return ok(await searchEmails(config, params));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "get_email",
  {
    description:
      "Fetch the full body and attachment list of one message by UID. Very long bodies are truncated, and messages over 25MB are refused.",
    inputSchema: {
      mailbox: z.string().default("INBOX"),
      uid: z.number().int().describe("UID from search_emails"),
    },
    annotations: READS,
  },
  async ({ mailbox, uid }) => {
    try {
      return ok(await getEmail(config, mailbox, uid));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "create_mailbox",
  {
    description:
      "Create a new folder. The server's namespace prefix is applied automatically.",
    inputSchema: {
      name: z.string().describe("Folder name, e.g. 'Clients' or 'Clients/Acme'"),
    },
    annotations: WRITES,
  },
  async ({ name }) => {
    try {
      return ok(await createMailbox(config, name));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "rename_mailbox",
  {
    description: "Rename an existing folder.",
    inputSchema: {
      oldName: z.string().describe("Current folder name"),
      newName: z.string().describe("New folder name"),
    },
    annotations: WRITES_ONCE,
  },
  async ({ oldName, newName }) => {
    try {
      return ok(await renameMailbox(config, oldName, newName));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "delete_mailbox",
  {
    description:
      "Permanently delete a folder and its contents. This cannot be undone.",
    inputSchema: { name: z.string().describe("Folder to delete") },
    annotations: DESTROYS,
  },
  async ({ name }) => {
    try {
      return ok(await deleteMailbox(config, name));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "mark_email",
  {
    description:
      "Mark a message as read/unread or flagged/unflagged. Fails if no message with that UID exists.",
    inputSchema: {
      mailbox: z.string().default("INBOX"),
      uid: z.number().int(),
      flag: z.enum(["seen", "flagged"]),
      add: z.boolean().describe("true to apply the flag, false to remove it"),
    },
    annotations: WRITES,
  },
  async ({ mailbox, uid, flag, add }) => {
    try {
      const imapFlag = flag === "seen" ? "\\Seen" : "\\Flagged";
      return ok(await markEmail(config, mailbox, uid, imapFlag, add));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "move_email",
  {
    description:
      "Move a message to another folder. Fails if no message with that UID exists.",
    inputSchema: {
      mailbox: z.string().describe("Source folder"),
      uid: z.number().int(),
      targetMailbox: z.string().describe("Destination folder"),
    },
    annotations: WRITES_ONCE,
  },
  async ({ mailbox, uid, targetMailbox }) => {
    try {
      return ok(await moveEmail(config, mailbox, uid, targetMailbox));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "send_email",
  {
    description:
      "Send an email via SMTP and save a copy to the Sent folder. Confirm the content with the user before calling this: sending cannot be undone.",
    inputSchema: {
      to: z.string().describe("Recipient address(es), comma separated"),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      subject: z.string(),
      text: z.string().optional().describe("Plain text body"),
      html: z.string().optional().describe("HTML body"),
    },
    annotations: WRITES_ONCE,
  },
  async (params) => {
    try {
      return ok(await sendEmail(config, params));
    } catch (e) {
      return fail(e);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-imap-smtp 1.21.0 running on stdio, account: ${account} (${config.imapUser})`
  );
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await shutdown().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
