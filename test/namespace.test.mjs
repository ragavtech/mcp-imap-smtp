import { detectNamespace } from "../dist/mailClient.js";

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ok    ${label} -> "${actual}"`);
  } else {
    fail++;
    console.log(`  FAIL  ${label} -> got "${actual}", expected "${expected}"`);
  }
}

// Typical Bluehost / cPanel Dovecot layout: everything nested under INBOX.
const cpanel = [
  { path: "INBOX", delimiter: "." },
  { path: "INBOX.Sent", delimiter: "." },
  { path: "INBOX.Drafts", delimiter: "." },
  { path: "INBOX.Trash", delimiter: "." },
  { path: "INBOX.spam", delimiter: "." },
];

// Gmail / most hosted providers: folders sit at the top level.
const gmail = [
  { path: "INBOX", delimiter: "/" },
  { path: "Sent", delimiter: "/" },
  { path: "Drafts", delimiter: "/" },
  { path: "Trash", delimiter: "/" },
  { path: "[Gmail]/All Mail", delimiter: "/" },
];

// Mixed: a few nested, but most top level. Should NOT be treated as prefixed.
const mixed = [
  { path: "INBOX", delimiter: "." },
  { path: "Sent", delimiter: "." },
  { path: "Drafts", delimiter: "." },
  { path: "Trash", delimiter: "." },
  { path: "INBOX.Archive", delimiter: "." },
];

// Bare mailbox with nothing but an inbox.
const bare = [{ path: "INBOX", delimiter: "." }];

console.log("\nnamespace detection");
check("cPanel nested", detectNamespace(cpanel).prefix, "INBOX.");
check("cPanel delimiter", detectNamespace(cpanel).delimiter, ".");
check("Gmail top level", detectNamespace(gmail).prefix, "");
check("Gmail delimiter", detectNamespace(gmail).delimiter, "/");
check("mixed leans top level", detectNamespace(mixed).prefix, "");
check("bare inbox only", detectNamespace(bare).prefix, "");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
