import { classify } from "../scripts/recovery.mjs";
import { setKey, removeKey, setPassword, setHost } from "../scripts/envfile.mjs";

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}\n        got      ${JSON.stringify(actual)}`);
    console.log(`        expected ${JSON.stringify(expected)}`);
  }
}

console.log("\nfailure classification");
check("imap auth rejection", classify("2 NO [AUTHENTICATIONFAILED] Authentication failed."), "auth");
check("imapflow generic failure", classify("Command failed"), "auth");
check("dns miss", classify("getaddrinfo ENOTFOUND mail.example.com"), "host");
check("refused port", classify("connect ECONNREFUSED 1.2.3.4:993"), "network");
check("timeout", classify("connect ETIMEDOUT"), "network");
check("self signed cert", classify("self signed certificate in chain"), "tls");
check("unrecognised", classify("something odd happened"), "unknown");

console.log("\nediting .env");

const base = "IMAP_HOST=old.com\nIMAP_USER=a@old.com\nIMAP_PASS=plain\n";

check(
  "replaces an existing key",
  setKey(base, "IMAP_HOST", "new.com"),
  "IMAP_HOST=new.com\nIMAP_USER=a@old.com\nIMAP_PASS=plain\n"
);

check(
  "appends a missing key",
  setKey("A=1\n", "B", "2"),
  "A=1\nB=2\n"
);

check("removes a key", removeKey(base, "IMAP_PASS"), "IMAP_HOST=old.com\nIMAP_USER=a@old.com\n");

check(
  "sets both host keys",
  setHost("IMAP_HOST=a\nSMTP_HOST=a\n", "", "b.com"),
  "IMAP_HOST=b.com\nSMTP_HOST=b.com\n"
);

// A password containing '#' must survive, since an unquoted '#' would start a
// comment and silently truncate it.
const tricky = 'Secret#123"x\'y';
const written = setPassword(base, "", tricky);
const encoded = written.match(/^IMAP_PASS_B64=(.*)$/m)?.[1] ?? "";
check(
  "password with # and quotes round trips",
  Buffer.from(encoded, "base64").toString("utf8"),
  tricky
);
check(
  "plain password variant is removed",
  /^IMAP_PASS=/m.test(written),
  false
);

// Prefixed accounts should only touch their own settings.
const two = "IMAP_HOST=main.com\nUK_IMAP_HOST=uk.com\nUK_SMTP_HOST=uk.com\n";
check(
  "prefixed edit leaves the default alone",
  setHost(two, "UK_", "new-uk.com"),
  "IMAP_HOST=main.com\nUK_IMAP_HOST=new-uk.com\nUK_SMTP_HOST=new-uk.com\n"
);

// Yes/no prompts: any case, the full words, and the documented defaults.
console.log("\nconfirm prompt parsing");

/** Mirrors the logic in scripts/prompt.mjs confirm(). */
function interpret(answer, defaultYes) {
  const a = String(answer).trim().toLowerCase();
  if (a === "") return defaultYes;
  if (/^(y|yes)$/.test(a)) return true;
  if (/^(n|no)$/.test(a)) return false;
  return null; // re-ask
}

check("lowercase y", interpret("y", false), true);
check("uppercase Y", interpret("Y", false), true);
check("word yes", interpret("yes", false), true);
check("word YES", interpret("YES", false), true);
check("lowercase n", interpret("n", true), false);
check("uppercase N", interpret("N", true), false);
check("word NO", interpret("NO", true), false);
check("Return takes the yes default", interpret("", true), true);
check("Return takes the no default", interpret("", false), false);
check("unrecognised answer re-asks", interpret("maybe", true), null);

// A mailbox added during a run must be visible to the code that tests it.
//
// dotenv does not overwrite variables already in the environment, so once
// ACCOUNTS has been loaded it never changes in that process. Reading the list
// by re-importing the module therefore misses anything added since startup,
// and an untested mailbox could reach the registration step. The fix is to
// read it in a fresh process; this test guards the reasoning.
console.log("\nreading the mailbox list after .env changes");

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const envPath = path.join(projectDir, ".env");
const hadEnv = existsSync(envPath);

if (!hadEnv) {
  writeFileSync(
    envPath,
    [
      "ACCOUNTS=alpha",
      "ALPHA_IMAP_HOST=mail.example.test",
      "ALPHA_IMAP_USER=alpha@example.test",
      "ALPHA_IMAP_PASS=x",
      "ALPHA_SMTP_HOST=mail.example.test",
      "ALPHA_SMTP_USER=alpha@example.test",
      "ALPHA_SMTP_PASS=x",
      "",
      "BETA_IMAP_HOST=mail.example.test",
      "BETA_IMAP_USER=beta@example.test",
      "BETA_IMAP_PASS=y",
      "BETA_SMTP_HOST=mail.example.test",
      "BETA_SMTP_USER=beta@example.test",
      "BETA_SMTP_PASS=y",
      "",
    ].join("\n")
  );

  const read = (accounts) => {
    const clean = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !/(^|_)(IMAP|SMTP)_/.test(k) && k !== "ACCOUNTS"
      )
    );
    const r = spawnSync(
      process.execPath,
      [
        "-e",
        "import('./dist/mailClient.js').then(m => process.stdout.write(JSON.stringify(m.listAccounts())))",
      ],
      { cwd: projectDir, encoding: "utf8", env: clean }
    );
    return JSON.parse(r.stdout || "[]");
  };

  check("a fresh process sees one mailbox", JSON.stringify(read()), '["alpha"]');

  // Simulate add-account listing a second mailbox.
  const current = readFileSync(envPath, "utf8");
  writeFileSync(envPath, current.replace("ACCOUNTS=alpha", "ACCOUNTS=alpha,beta"));

  check(
    "a fresh process sees the mailbox added since",
    JSON.stringify(read()),
    '["alpha","beta"]'
  );

  unlinkSync(envPath);
} else {
  check("skipped: a real .env is present", true, "");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
