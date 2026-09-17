// Prompt helpers shared by the setup scripts.
//
// These read exactly one line at a time. Reading in larger chunks would
// swallow input intended for a script spawned afterwards, which silently
// breaks any flow that chains prompts together.

import { readSync } from "node:fs";
import { stdin, stdout } from "node:process";

function readLine() {
  const buf = Buffer.alloc(1);
  let value = "";
  while (true) {
    let bytes = 0;
    try {
      bytes = readSync(0, buf, 0, 1, null);
    } catch (err) {
      if (err.code === "EAGAIN") continue;
      break;
    }
    if (bytes === 0) break;
    const char = buf.toString("utf8", 0, 1);
    if (char === "\n") break;
    if (char !== "\r") value += char;
  }
  return value;
}

export function ask(question) {
  stdout.write(question);
  return readLine().trim();
}

/**
 * A yes/no question. Any case is accepted, as are the full words, so y, Y,
 * yes and YES all mean the same thing. `defaultYes` decides what pressing
 * Return alone does, and is shown by which letter is capitalised.
 */
export function confirm(question, { defaultYes = true } = {}) {
  const choices = defaultYes ? "[Y/n]" : "[y/N]";
  const dimmed =
    stdout.isTTY && !process.env.NO_COLOR
      ? `\u001b[2m${choices}\u001b[22m`
      : choices;
  const arrow =
    stdout.isTTY && !process.env.NO_COLOR ? "\u001b[36m\u203a\u001b[39m" : "\u203a";

  while (true) {
    const answer = ask(`  ${question} ${dimmed} ${arrow} `).toLowerCase();
    if (answer === "") return defaultYes;
    if (/^(y|yes)$/.test(answer)) return true;
    if (/^(n|no)$/.test(answer)) return false;
    stdout.write("  Please type y for yes, or n for no.\n");
  }
}

/**
 * Reads a secret without showing it, but masks each character so you can see
 * that input is registering. A prompt that shows nothing at all gives no way
 * to tell whether a paste landed, landed twice, or did not land.
 *
 * Bytes are collected raw and decoded once at the end, so accented or
 * non-Latin characters survive intact.
 */
export function askHidden(question, { mask = true } = {}) {
  stdout.write(question);
  if (!stdin.isTTY) {
    const piped = readLine().trim();
    reportLength(piped);
    return piped;
  }

  stdin.setRawMode(true);
  const buf = Buffer.alloc(1);
  let bytes = [];
  let shown = 0;

  const redraw = () => {
    if (!mask) return;
    const chars = [...Buffer.from(bytes).toString("utf8")].length;
    if (chars > shown) stdout.write("•".repeat(chars - shown));
    else if (chars < shown) stdout.write("\b \b".repeat(shown - chars));
    shown = chars;
  };

  try {
    while (true) {
      let read = 0;
      try {
        read = readSync(0, buf, 0, 1, null);
      } catch (err) {
        if (err.code === "EAGAIN") continue;
        break;
      }
      if (read === 0) break;
      const byte = buf[0];
      if (byte === 0x0a || byte === 0x0d || byte === 0x04) break;
      if (byte === 0x03) {
        stdin.setRawMode(false);
        stdout.write("\n");
        process.exit(1);
      }
      if (byte === 0x7f || byte === 0x08) {
        const text = Buffer.from(bytes).toString("utf8");
        bytes = Array.from(Buffer.from([...text].slice(0, -1).join(""), "utf8"));
      } else {
        bytes.push(byte);
      }
      redraw();
    }
  } finally {
    stdin.setRawMode(false);
  }

  const value = Buffer.from(bytes).toString("utf8");
  reportLength(value);
  return value;
}

/** Confirms how much was captured, so a failed or doubled paste is visible. */
function reportLength(value) {
  const count = [...value].length;
  const text = `  (${count} character${count === 1 ? "" : "s"})`;
  const dimmed =
    stdout.isTTY && !process.env.NO_COLOR ? `\u001b[2m${text}\u001b[22m` : text;
  stdout.write(dimmed + "\n");
}
