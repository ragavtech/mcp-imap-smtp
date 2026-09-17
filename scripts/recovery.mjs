// Works out why a mailbox failed to connect, and offers recovery options that
// suit that particular failure rather than a generic "check your settings".

import path from "node:path";
import { stdout } from "node:process";
import {
  readEnv,
  save,
  setKey,
  setPassword,
  setHost,
  setUser,
  setPort,
} from "./envfile.mjs";
import { say, hint, ok, fail, warn, blank, bold, dim, cyan } from "./ui.mjs";

/** Categorises a failure so the right options can be offered. */
export function classify(message = "") {
  const text = String(message);
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|Command failed/i.test(text))
    return "auth";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return "host";
  if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timed out/i.test(text))
    return "network";
  if (/self.signed|certificate|CERT_|SSL|TLS/i.test(text)) return "tls";
  return "unknown";
}

const EXPLANATIONS = {
  auth: [
    "The mail server did not accept your email address or password.",
    "Usually this means one of the two is wrong.",
  ],
  host: [
    "The mail server address was not found.",
    "This is usually a spelling mistake in the address.",
  ],
  network: [
    "The mail server did not answer.",
    "The port may be wrong, or a firewall or VPN may be blocking it.",
  ],
  tls: [
    "The mail server's security certificate could not be checked.",
    "This is common on shared hosting.",
  ],
  unknown: ["The connection failed, and the reason is not clear."],
};

/**
 * Options to offer for a failure. Each has a key shown to the user, a label,
 * and an `apply` that edits .env and returns true if something changed.
 */
function optionsFor(kind, ctx) {
  const { prefix } = ctx;
  const base = [];

  if (kind === "auth") {
    base.push({
      label: "Type the password again",
      apply: (env, ask, askHidden) => {
        const password = askHidden(
          `\n  ${bold("Password")}\n  ${dim("Dots appear as you type, and the length is shown.")}\n  ${cyan("\u203a")} `
        );
        if (!password) return null;
        return setPassword(env, prefix, password);
      },
    });
    base.push({
      label: "Type the email address again",
      apply: (env, ask) => {
        const email = ask(
          `\n  ${bold("Email address")}\n  ${dim("Type the full address, including the part after the @.")}\n  ${cyan("\u203a")} `
        );
        if (!email.includes("@")) {
          warn("That does not look like an email address.");
          return null;
        }
        return setUser(env, prefix, email);
      },
    });
  }

  if (kind === "host" || kind === "network" || kind === "unknown") {
    base.push({
      label: "Type the mail server address again",
      apply: (env, ask) => {
        const host = ask(
          `\n  ${bold("Mail server address")}\n  ${dim("Example: mail.yourdomain.com")}\n  ${cyan("\u203a")} `
        );
        if (!host) return null;
        return setHost(env, prefix, host);
      },
    });
  }

  if (kind === "network" || kind === "unknown") {
    base.push({
      label: "Try the other common ports (143 and 587)",
      apply: (env) => {
        let out = setPort(env, prefix, 143, 587);
        out = setKey(out, `${prefix}IMAP_SECURE`, "false");
        out = setKey(out, `${prefix}SMTP_SECURE`, "false");
        return out;
      },
    });
  }

  if (kind === "tls") {
    base.push({
      label: "Connect anyway, without checking the certificate",
      warning: "Only choose this if you trust this mail server.",
      apply: (env) => setKey(env, `${prefix}TLS_REJECT_UNAUTHORIZED`, "false"),
    });
  }

  base.push({
    label: "Enter all the details again",
    apply: (env, ask, askHidden) => {
      const email = ask(
        `\n  ${bold("Email address")}\n  ${cyan("\u203a")} `
      );
      if (!email.includes("@")) {
        warn("That does not look like an email address.");
        return null;
      }
      const guess = "mail." + email.split("@")[1];
      const host =
        ask(`\n  ${bold("Mail server address")}\n  ${dim(`Press Enter to use ${guess}.`)}\n  ${cyan("\u203a")} `) ||
        guess;
      const password = askHidden(
        `\n  ${bold("Password")}\n  ${dim("Dots appear as you type, and the length is shown.")}\n  ${cyan("\u203a")} `
      );
      if (!password) return null;
      let out = setUser(env, prefix, email);
      out = setHost(out, prefix, host);
      return setPassword(out, prefix, password);
    },
  });

  return base;
}

/**
 * Offers recovery after a failed connection. Returns "retry" if something was
 * changed and the mailbox should be tested again, or "skip" to move on.
 *
 * `attempts` is the number of failures so far for this mailbox. Repeated
 * authentication failures are treated specially: shared cPanel hosts block an
 * IP after a few, and further attempts make that worse rather than better.
 */
export function offerRecovery({
  kind,
  projectDir,
  prefix,
  attempts,
  ask,
  askHidden,
  confirm,
}) {
  blank();
  for (const l of EXPLANATIONS[kind] ?? EXPLANATIONS.unknown) hint(l);

  if (kind === "auth" && attempts >= 2) {
    blank();
    warn("Two failed logins in a row.");
    blank();
    hint("Many mail hosts block your internet connection after a few failed");
    hint("logins. They then refuse even the correct password. Trying again");
    hint("now can make the block last longer.");
    blank();
    hint("What to do: open your webmail in a browser and sign in there. If");
    hint("that works, your password is fine. Wait 15 to 30 minutes, then");
    hint("run 'npm start' again.");
    blank();
    if (!confirm("Try anyway?", { defaultYes: false })) return "skip";
  }

  const options = optionsFor(kind, { prefix });
  blank();
  say(bold("What would you like to do?"));
  blank();
  options.forEach((o, i) => {
    say(`  ${cyan(String(i + 1))}  ${o.label}`);
    if (o.warning) hint(`     ${o.warning}`);
  });
  say(`  ${cyan(String(options.length + 1))}  Leave this mailbox for now`);
  blank();

  const choice = ask(
    `Type a number ${dim(`[1-${options.length + 1}]`)} ${cyan("\u203a")} `
  );
  const index = Number(choice) - 1;

  if (Number.isNaN(index) || index < 0 || index >= options.length) return "skip";

  const envPath = path.join(projectDir, ".env");
  const updated = options[index].apply(readEnv(envPath), ask, askHidden);
  if (!updated) return "skip";

  save(envPath, updated);
  blank();
  ok("Updated. Trying again...");
  return "retry";
}
