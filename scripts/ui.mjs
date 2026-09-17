// Shared look and feel for the setup scripts.
//
// Colour is disabled automatically when output is not a terminal, when NO_COLOR
// is set, or when TERM is "dumb", so piped output and CI logs stay readable.

import { stdout } from "node:process";

const useColour =
  stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const wrap = (open, close) => (text) =>
  useColour ? `\u001b[${open}m${text}\u001b[${close}m` : String(text);

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const cyan = wrap(36, 39);
export const green = wrap(32, 39);
export const red = wrap(31, 39);
export const yellow = wrap(33, 39);

export const tick = green("✓");
export const cross = red("✗");
export const arrow = cyan("›");
export const dot = dim("·");

const WIDTH = 60;

/** The banner shown once at the top of a run. */
export function banner(title, subtitle) {
  const inner = WIDTH - 2;
  const pad = (text, visibleLength) =>
    text + " ".repeat(Math.max(0, inner - 2 - visibleLength));

  stdout.write("\n");
  stdout.write(cyan(`  ╭${"─".repeat(inner)}╮`) + "\n");
  stdout.write(
    cyan("  │") + "  " + bold(pad(title, title.length)) + cyan("│") + "\n"
  );
  if (subtitle) {
    stdout.write(
      cyan("  │") + "  " + dim(pad(subtitle, subtitle.length)) + cyan("│") + "\n"
    );
  }
  stdout.write(cyan(`  ╰${"─".repeat(inner)}╯`) + "\n\n");
}

/** A section heading, optionally numbered as a step. */
export function step(current, total, title) {
  const label =
    current && total
      ? `${dim(`Step ${current} of ${total}`)} ${dot} ${bold(title)}`
      : bold(title);
  stdout.write("\n  " + label + "\n");
  stdout.write("  " + dim("─".repeat(Math.min(WIDTH, title.length + 18))) + "\n\n");
}

export function say(text = "") {
  stdout.write("  " + text + "\n");
}

export function hint(text) {
  stdout.write("  " + dim(text) + "\n");
}

export function ok(text) {
  stdout.write(`  ${tick} ${text}\n`);
}

export function fail(text) {
  stdout.write(`  ${cross} ${text}\n`);
}

export function warn(text) {
  stdout.write(`  ${yellow("!")} ${text}\n`);
}

export function blank() {
  stdout.write("\n");
}

/** Label above an input, with the prompt marker on its own line. */
export function field(label, helpText) {
  stdout.write("\n  " + bold(label) + "\n");
  if (helpText) stdout.write("  " + dim(helpText) + "\n");
  return `  ${arrow} `;
}

/**
 * One question in a numbered sequence. Keeping each to a single line of help
 * and a consistent indent makes a run of questions read as steps rather than
 * as a wall of prose.
 *
 *   1/4  Email address
 *        e.g. you@yourdomain.com
 *        ›
 */
export function question(number, total, label, helpText) {
  const counter = dim(`${number}/${total}`);
  stdout.write(`\n  ${counter}  ${bold(label)}\n`);
  if (helpText) stdout.write(`       ${dim(helpText)}\n`);
  return `       ${arrow} `;
}

/** Confirms an answer under the question it belongs to. */
export function answered(text) {
  stdout.write(`       ${green("✓")} ${dim(text)}\n`);
}

/** A row in a list, e.g. when showing configured mailboxes. */
export function row(left, right, marker = " ") {
  stdout.write(`  ${marker} ${cyan(String(left).padEnd(16))} ${right}\n`);
}
