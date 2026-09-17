#!/usr/bin/env node
// Connection check for every account defined in .env.
//   npm run diagnose          all accounts
//   npm run diagnose -- uk    one account
import { say, hint, ok, fail, blank, bold, dim, cyan } from "./ui.mjs";
import {
  loadConfigFromEnv,
  listAccounts,
  inspectAccounts,
  diagnose,
  shutdown,
} from "../dist/mailClient.js";

function explain(msg) {
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) {
    return [
      "The mail hostname could not be found. Check IMAP_HOST in .env for typos,",
      "and confirm it in cPanel under Email Accounts, Connect Devices.",
    ];
  }
  if (/AUTHENTICATIONFAILED|Command failed|Invalid credentials/i.test(msg)) {
    return [
      "The server rejected the login. Check that IMAP_USER is the full email",
      "address and the password is correct.",
      "",
      "If this worked before and suddenly stopped, you may be locked out: shared",
      "cPanel hosts block your IP after repeated failed logins. Stop retrying,",
      "test the password in webmail, and wait 15 to 30 minutes.",
    ];
  }
  if (/ECONNREFUSED|ETIMEDOUT/.test(msg)) {
    return ["Could not reach that port. Check IMAP_PORT (usually 993)."];
  }
  if (/self.signed|certificate/i.test(msg)) {
    return [
      "TLS certificate problem, common on shared hosting. If you trust the host,",
      "set TLS_REJECT_UNAUTHORIZED=false in .env, understanding the risk.",
    ];
  }
  return [];
}

const requested = process.argv[2];
const accounts = requested ? [requested] : listAccounts();

if (accounts.length === 0) {
  blank(); fail("No mailbox configured yet. Run 'npm start'."); blank();
  process.exit(1);
}

// Warn about half-configured accounts before attempting any connection, and
// name the exact variables that are missing. The prefix rule is easy to get
// wrong by hand, so say what to add rather than just failing to connect.
const incomplete = inspectAccounts().filter((a) => !a.complete);
if (incomplete.length) {
  blank();
  for (const a of incomplete) {
    fail(`'${a.name}' is listed in ACCOUNTS but incomplete.`);
    hint("Add these to .env:");
    for (const key of a.missing) hint(`  ${key}=`);
    hint("Or run 'npm run add-account' to be prompted for them.");
  }
}

let failed = 0;

for (const account of accounts) {
  if (!process.env.MCP_GUIDED) {
    blank();
    say(bold(account));
  }
  try {
    const config = loadConfigFromEnv(account);
    const result = await diagnose(config);
    for (const [key, value] of Object.entries(result)) {
      say(dim(key.padEnd(22)) + " " + String(value));
    }
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    fail(msg);
    // During 'npm start' the recovery step explains the failure and offers
    // options, so repeating the advice here would say the same thing twice.
    if (!process.env.MCP_GUIDED) {
      blank();
      for (const l of explain(msg)) hint(l);
    }
  }
  await shutdown().catch(() => {});
}

if (!process.env.MCP_GUIDED) {
  blank();
  say(`${accounts.length - failed} of ${accounts.length} mailbox(es) OK`);
  blank();
}
process.exit(failed ? 1 : 0);
