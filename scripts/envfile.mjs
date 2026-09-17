// Reading and updating individual settings in .env, used when a mailbox needs
// correcting after a failed connection.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function readEnv(envPath) {
  return existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
}

/**
 * Sets a key, replacing an existing line if present and appending otherwise.
 * Commented-out lines for the same key are left alone.
 */
export function setKey(text, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (pattern.test(text)) return text.replace(pattern, line);
  return text.replace(/\n*$/, "\n") + line + "\n";
}

/** Removes a key entirely. */
export function removeKey(text, key) {
  return text.replace(new RegExp(`^${key}=.*\\n?`, "m"), "");
}

/** Writes the password for a mailbox, base64 encoded so any character survives. */
export function setPassword(text, prefix, password) {
  const encoded = Buffer.from(password, "utf8").toString("base64");
  let out = text;
  // Drop any plain-text variants so the encoded one is unambiguous.
  out = removeKey(out, `${prefix}IMAP_PASS`);
  out = removeKey(out, `${prefix}SMTP_PASS`);
  out = setKey(out, `${prefix}IMAP_PASS_B64`, encoded);
  out = setKey(out, `${prefix}SMTP_PASS_B64`, encoded);
  return out;
}

/** Sets both hosts to the same value, for a domain on its own hosting. */
export function setHost(text, prefix, host) {
  let out = setKey(text, `${prefix}IMAP_HOST`, host);
  return setKey(out, `${prefix}SMTP_HOST`, host);
}

export function setUser(text, prefix, email) {
  let out = setKey(text, `${prefix}IMAP_USER`, email);
  return setKey(out, `${prefix}SMTP_USER`, email);
}

export function setPort(text, prefix, imapPort, smtpPort) {
  let out = setKey(text, `${prefix}IMAP_PORT`, String(imapPort));
  return setKey(out, `${prefix}SMTP_PORT`, String(smtpPort));
}

export function save(envPath, text) {
  writeFileSync(envPath, text, { mode: 0o600 });
}
