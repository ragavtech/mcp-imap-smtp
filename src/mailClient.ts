import { ImapFlow, type ListResponse } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load .env from the project root, not the current working directory.
// Claude Desktop launches this server from an arbitrary directory, so relying
// on cwd would mean credentials had to be duplicated into the client config.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "..", ".env") });

/** Names of every account defined in .env. The unprefixed one is "default". */
export function listAccounts(): string[] {
  const extra = (process.env.ACCOUNTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const accounts: string[] = [];
  if (process.env.IMAP_HOST) accounts.push("default");
  for (const name of extra) if (!accounts.includes(name)) accounts.push(name);
  return accounts;
}

/** Turns an account name into its .env variable prefix. */
export function prefixFor(account?: string): string {
  if (!account || account === "default") return "";
  return account.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_";
}

const REQUIRED_KEYS = [
  "IMAP_HOST",
  "IMAP_USER",
  "IMAP_PASS",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
];

/**
 * Reports which accounts are complete and which are missing settings, with the
 * exact variable names to add. The prefix rule is not obvious, so mistakes
 * should be explained rather than just rejected.
 */
export function inspectAccounts(): {
  name: string;
  prefix: string;
  complete: boolean;
  missing: string[];
  user?: string;
}[] {
  return listAccounts().map((name) => {
    const p = prefixFor(name);
    const missing = REQUIRED_KEYS.filter((key) => {
      // A password may be stored plainly or base64 encoded.
      if (key.endsWith("_PASS")) {
        return !process.env[p + key] && !process.env[p + key + "_B64"];
      }
      return !process.env[p + key];
    }).map((key) => p + key);
    return {
      name,
      prefix: p || "(none)",
      complete: missing.length === 0,
      missing,
      user: process.env[p + "IMAP_USER"],
    };
  });
}

export interface MailConfig {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPass: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  saveToSent: boolean;
  rejectUnauthorized: boolean;
  idleTimeoutMs: number;
}

export function loadConfigFromEnv(account?: string): MailConfig {
  const p = prefixFor(account);
  const get = (key: string) => process.env[p + key];

  /**
   * Passwords may be stored plainly, or base64 encoded under a _B64 suffix.
   *
   * The encoding is not security: it is there because .env files cannot
   * reliably carry every character. An unquoted '#' starts a comment, and
   * dotenv's quoting does not survive a value containing both quote types, so
   * a password with those characters would be silently truncated. Encoding
   * sidesteps the file format entirely. A plain value still works and is
   * easier to hand-edit, so both are accepted.
   */
  const secret = (key: string) => {
    const encoded = get(key + "_B64");
    if (encoded) {
      try {
        return Buffer.from(encoded, "base64").toString("utf8");
      } catch {
        throw new Error(`${p}${key}_B64 is not valid base64.`);
      }
    }
    return get(key);
  };

  const required: [string, string | undefined][] = [
    ["IMAP_HOST", get("IMAP_HOST")],
    ["IMAP_USER", get("IMAP_USER")],
    ["IMAP_PASS", secret("IMAP_PASS")],
    ["SMTP_HOST", get("SMTP_HOST")],
    ["SMTP_USER", get("SMTP_USER")],
    ["SMTP_PASS", secret("SMTP_PASS")],
  ];
  const missing = required.filter(([, value]) => !value).map(([key]) => p + key);
  if (missing.length) {
    const label = account && account !== "default" ? ` for account "${account}"` : "";
    const known = listAccounts();
    throw new Error(
      `Missing required settings${label}: ${missing.join(", ")}. ` +
        (known.length
          ? `Accounts defined in .env: ${known.join(", ")}.`
          : `Copy .env.example to .env and fill it in.`)
    );
  }
  return {
    imapHost: get("IMAP_HOST")!,
    imapPort: Number(get("IMAP_PORT") ?? 993),
    imapSecure: (get("IMAP_SECURE") ?? "true") === "true",
    imapUser: get("IMAP_USER")!,
    imapPass: secret("IMAP_PASS")!,
    smtpHost: get("SMTP_HOST")!,
    smtpPort: Number(get("SMTP_PORT") ?? 465),
    smtpSecure: (get("SMTP_SECURE") ?? "true") === "true",
    smtpUser: get("SMTP_USER")!,
    smtpPass: secret("SMTP_PASS")!,
    fromAddress: get("FROM_ADDRESS") ?? get("SMTP_USER")!,
    saveToSent: (get("SAVE_TO_SENT") ?? "true") === "true",
    rejectUnauthorized:
      (get("TLS_REJECT_UNAUTHORIZED") ?? "true") === "true",
    idleTimeoutMs: Number(get("IDLE_TIMEOUT_MS") ?? 60000),
  };
}

let shared: ImapFlow | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let connecting: Promise<ImapFlow> | null = null;

function scheduleIdleClose(config: MailConfig) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const c = shared;
    shared = null;
    idleTimer = null;
    if (c) c.logout().catch(() => c.close());
  }, config.idleTimeoutMs);
  if (typeof idleTimer.unref === "function") idleTimer.unref();
}

async function connect(config: MailConfig): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    auth: { user: config.imapUser, pass: config.imapPass },
    logger: false,
    tls: { rejectUnauthorized: config.rejectUnauthorized },
  });
  await client.connect();
  client.on("close", () => {
    if (shared === client) shared = null;
  });
  client.on("error", () => {
    if (shared === client) shared = null;
  });
  return client;
}

async function getClient(config: MailConfig): Promise<ImapFlow> {
  if (shared && shared.usable) {
    scheduleIdleClose(config);
    return shared;
  }
  if (connecting) return connecting;
  connecting = connect(config)
    .then((c) => {
      shared = c;
      connecting = null;
      scheduleIdleClose(config);
      return c;
    })
    .catch((e) => {
      connecting = null;
      throw e;
    });
  return connecting;
}

function isTransient(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // A rejected login is never worth retrying. Shared hosts block an IP after a
  // few failures, so retrying turns a wrong password into a lockout. This
  // check comes first because such messages often mention "connection" too.
  if (
    m.includes("authenticationfailed") ||
    m.includes("invalid credentials") ||
    m.includes("authentication failed") ||
    m.includes("login failed")
  ) {
    return false;
  }
  return (
    m.includes("too many") ||
    m.includes("connection") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("closed") ||
    m.includes("socket") ||
    m.includes("unavailable")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Largest message this will pull into memory. */
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/** Longest body returned to the assistant, to avoid flooding its context. */
const MAX_BODY_CHARS = 100_000;

function truncate(text?: string): string | undefined {
  if (!text || text.length <= MAX_BODY_CHARS) return text;
  return (
    text.slice(0, MAX_BODY_CHARS) +
    `\n\n[truncated: ${text.length - MAX_BODY_CHARS} more characters]`
  );
}

async function withImap<T>(
  config: MailConfig,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const client = await getClient(config);
      return await fn(client);
    } catch (e) {
      lastErr = e;
      if (!isTransient(e)) throw e;
      const c = shared;
      shared = null;
      if (c) c.close();
      if (attempt < 2) await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

interface FolderInfo {
  prefix: string;
  delimiter: string;
  boxes: ListResponse[];
}

let folderCache: { at: number; data: FolderInfo } | null = null;

/**
 * Works out whether this server nests folders under an "INBOX." namespace
 * (common on cPanel/Dovecot) or keeps them at the top level (Gmail, most
 * hosted providers). Pure function so it can be tested without a server.
 */
export function detectNamespace(
  boxes: Pick<ListResponse, "path" | "delimiter">[]
): { prefix: string; delimiter: string } {
  const inbox = boxes.find((b) => b.path.toUpperCase() === "INBOX");
  const delimiter = inbox?.delimiter || boxes[0]?.delimiter || ".";
  const nested = boxes.filter((b) =>
    b.path.toUpperCase().startsWith("INBOX" + delimiter)
  ).length;
  const topLevel = boxes.filter(
    (b) => b.path.toUpperCase() !== "INBOX" && !b.path.includes(delimiter)
  ).length;
  return { prefix: nested > topLevel ? "INBOX" + delimiter : "", delimiter };
}

async function getFolderInfo(config: MailConfig): Promise<FolderInfo> {
  if (folderCache && Date.now() - folderCache.at < 300000)
    return folderCache.data;
  const data = await withImap(config, async (client) => {
    const boxes = await client.list();
    const { prefix, delimiter } = detectNamespace(boxes);
    return { prefix, delimiter, boxes };
  });
  folderCache = { at: Date.now(), data };
  return data;
}

export async function resolvePath(
  config: MailConfig,
  name: string
): Promise<string> {
  const { prefix, boxes } = await getFolderInfo(config);
  if (name.toUpperCase() === "INBOX") return "INBOX";
  const exact = boxes.find((b) => b.path.toLowerCase() === name.toLowerCase());
  if (exact) return exact.path;
  const leaf = boxes.find(
    (b) => (b.name || "").toLowerCase() === name.toLowerCase()
  );
  if (leaf) return leaf.path;
  return prefix ? prefix + name : name;
}

async function findSentFolder(config: MailConfig): Promise<string> {
  const { boxes, prefix } = await getFolderInfo(config);
  const flagged = boxes.find((b) => b.specialUse === "\\Sent");
  if (flagged) return flagged.path;
  const names = ["sent", "sent items", "sent mail", "sentmail"];
  const byName = boxes.find(
    (b) =>
      names.includes((b.name || "").toLowerCase()) ||
      names.includes(b.path.toLowerCase())
  );
  if (byName) return byName.path;
  return prefix ? prefix + "Sent" : "Sent";
}

export async function listMailboxes(config: MailConfig) {
  const { prefix, delimiter } = await getFolderInfo(config);
  return withImap(config, async (client) => {
    const list = await client.list();
    return {
      namespacePrefix: prefix || "(none)",
      delimiter,
      folders: list.map((box: ListResponse) => ({
        path: box.path,
        name: box.name,
        specialUse: box.specialUse ?? null,
        subscribed: box.subscribed ?? null,
      })),
    };
  });
}

export async function createMailbox(config: MailConfig, name: string) {
  const { prefix } = await getFolderInfo(config);
  const path = name.toUpperCase().startsWith("INBOX") ? name : prefix + name;
  return withImap(config, async (client) => {
    await client.mailboxCreate(path);
    folderCache = null;
    return { created: path };
  });
}

export async function renameMailbox(
  config: MailConfig,
  oldName: string,
  newName: string
) {
  const from = await resolvePath(config, oldName);
  const { prefix } = await getFolderInfo(config);
  const to = newName.toUpperCase().startsWith("INBOX")
    ? newName
    : prefix + newName;
  return withImap(config, async (client) => {
    await client.mailboxRename(from, to);
    folderCache = null;
    return { renamedFrom: from, renamedTo: to };
  });
}

export async function deleteMailbox(config: MailConfig, name: string) {
  const path = await resolvePath(config, name);
  return withImap(config, async (client) => {
    await client.mailboxDelete(path);
    folderCache = null;
    return { deleted: path };
  });
}

export interface SearchParams {
  mailbox: string;
  unseenOnly?: boolean;
  from?: string;
  subject?: string;
  since?: string;
  limit?: number;
  offset?: number;
}

export async function searchEmails(config: MailConfig, params: SearchParams) {
  const { unseenOnly, from, subject, since, limit = 20, offset = 0 } = params;
  const mailbox = await resolvePath(config, params.mailbox);
  return withImap(config, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const criteria: Record<string, unknown> = {};
      if (unseenOnly) criteria.seen = false;
      if (from) criteria.from = from;
      if (subject) criteria.subject = subject;
      if (since) criteria.since = new Date(since);

      // search() returns false when the server declines the query. Casting to
      // number[] hid that, and .slice() on false throws.
      const found = await client.search(
        Object.keys(criteria).length ? criteria : { all: true },
        { uid: true }
      );
      const uids: number[] = Array.isArray(found) ? found : [];

      const total = uids.length;
      // Newest first, then the requested window. Only this window is fetched,
      // so a large mailbox does not pull every message.
      const ordered = uids.slice().reverse();
      const window = ordered.slice(offset, offset + limit);

      if (!window.length) {
        return {
          mailbox,
          total,
          offset,
          count: 0,
          hasMore: offset < total,
          messages: [],
        };
      }

      const results = [];
      for await (const msg of client.fetch(
        window,
        { envelope: true, flags: true, uid: true },
        { uid: true }
      )) {
        results.push({
          uid: msg.uid,
          subject: msg.envelope?.subject ?? "(no subject)",
          from: msg.envelope?.from?.map((a) => a.address).join(", "),
          to: msg.envelope?.to?.map((a) => a.address).join(", "),
          date: msg.envelope?.date,
          unread: !Array.from(msg.flags ?? []).includes("\\Seen"),
        });
      }
      // fetch does not guarantee order, so restore newest first.
      const order = new Map(window.map((uid, i) => [uid, i]));
      results.sort((a, b) => (order.get(a.uid!) ?? 0) - (order.get(b.uid!) ?? 0));

      const nextOffset = offset + results.length;
      return {
        mailbox,
        total,
        offset,
        count: results.length,
        hasMore: nextOffset < total,
        nextOffset: nextOffset < total ? nextOffset : undefined,
        messages: results,
      };
    } finally {
      lock.release();
    }
  });
}

export async function getEmail(
  config: MailConfig,
  mailboxName: string,
  uid: number
) {
  const mailbox = await resolvePath(config, mailboxName);
  return withImap(config, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const raw = await client.download(String(uid), undefined, { uid: true });
      const chunks: Buffer[] = [];
      let bytes = 0;
      // A message with large attachments would otherwise be buffered whole.
      for await (const chunk of raw.content) {
        const buf = chunk as Buffer;
        bytes += buf.length;
        if (bytes > MAX_MESSAGE_BYTES) {
          throw new Error(
            `Message ${uid} is larger than ${Math.round(
              MAX_MESSAGE_BYTES / 1024 / 1024
            )}MB and was not downloaded. Open it in a mail client instead.`
          );
        }
        chunks.push(buf);
      }
      const parsed = await simpleParser(Buffer.concat(chunks));
      return {
        uid,
        mailbox,
        subject: parsed.subject,
        from: parsed.from?.text,
        to: parsed.to && "text" in parsed.to ? parsed.to.text : undefined,
        date: parsed.date,
        text: truncate(parsed.text),
        attachments: parsed.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

export async function markEmail(
  config: MailConfig,
  mailboxName: string,
  uid: number,
  flag: "\\Seen" | "\\Flagged",
  add: boolean
) {
  const mailbox = await resolvePath(config, mailboxName);
  return withImap(config, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const changed = add
        ? await client.messageFlagsAdd(String(uid), [flag], { uid: true })
        : await client.messageFlagsRemove(String(uid), [flag], { uid: true });
      // The server reports whether anything matched. Ignoring it meant a
      // non-existent message was reported as successfully flagged.
      if (!changed) {
        throw new Error(
          `No message with uid ${uid} in ${mailbox}, so nothing was changed.`
        );
      }
      return { uid, mailbox, flag, applied: add };
    } finally {
      lock.release();
    }
  });
}

export async function moveEmail(
  config: MailConfig,
  mailboxName: string,
  uid: number,
  targetName: string
) {
  const mailbox = await resolvePath(config, mailboxName);
  const target = await resolvePath(config, targetName);
  return withImap(config, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const moved = await client.messageMove(String(uid), target, { uid: true });
      if (!moved) {
        throw new Error(
          `No message with uid ${uid} in ${mailbox}, so nothing was moved.`
        );
      }
      return { uid, movedFrom: mailbox, movedTo: target };
    } finally {
      lock.release();
    }
  });
}

export interface SendParams {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(config: MailConfig, params: SendParams) {
  const mailOptions = {
    from: config.fromAddress,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    text: params.text,
    html: params.html,
  };

  const raw: Buffer = await new Promise((resolve, reject) => {
    new MailComposer(mailOptions)
      .compile()
      .build((err: Error | null, msg: Buffer) => {
        if (err) reject(err);
        else resolve(msg);
      });
  });

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPass },
    tls: { rejectUnauthorized: config.rejectUnauthorized },
  });

  const info = await transporter.sendMail({
    envelope: {
      from: config.fromAddress,
      to: [params.to, params.cc, params.bcc]
        .filter(Boolean)
        .join(",")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    raw,
  });

  let savedTo: string | null = null;
  let saveError: string | null = null;
  if (config.saveToSent) {
    try {
      const sentPath = await findSentFolder(config);
      await withImap(config, async (client) => {
        await client.append(sentPath, raw, ["\\Seen"]);
      });
      savedTo = sentPath;
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    savedToSent: savedTo,
    saveToSentError: saveError,
  };
}

export async function diagnose(config: MailConfig) {
  const info = await getFolderInfo(config);
  const sent = await findSentFolder(config);
  return {
    imap: `${config.imapHost}:${config.imapPort} (secure: ${config.imapSecure})`,
    smtp: `${config.smtpHost}:${config.smtpPort} (secure: ${config.smtpSecure})`,
    user: config.imapUser,
    from: config.fromAddress,
    namespacePrefix: info.prefix || "(none, folders are top level)",
    delimiter: info.delimiter,
    folderCount: info.boxes.length,
    detectedSentFolder: sent,
    saveToSentEnabled: config.saveToSent,
    connectionReuse: `on, idle close after ${info ? config.idleTimeoutMs : 0}ms`,
  };
}

export async function shutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  const c = shared;
  shared = null;
  if (c) await c.logout().catch(() => c.close());
}
