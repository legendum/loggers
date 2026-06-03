/**
 * Terminal + stdin readers for CLIs.
 *
 * `readLineSync` reads one line from the controlling terminal (`/dev/tty`),
 * not stdin — so an interactive prompt still works when stdin is a pipe
 * (the common `echo … | dj …` case). `prompt` writes a label first.
 *
 * `readStdin` drains piped input; it returns "" when stdin is a TTY so a
 * CLI can call it unconditionally to pick up `cat foo | cli …` without
 * blocking on an interactive terminal.
 */

import { closeSync, openSync, readSync } from "node:fs";

/** Read a single line from the controlling terminal (`/dev/tty`). */
export function readLineSync(): string {
  const buf = Buffer.alloc(4096);
  const fd = openSync("/dev/tty", "r");
  try {
    const n = readSync(fd, buf, 0, buf.length, null);
    return buf.toString("utf-8", 0, n).replace(/\r?\n$/, "");
  } finally {
    closeSync(fd);
  }
}

/** Write `label` to stdout, then read one trimmed line from the terminal. */
export function prompt(label: string): string {
  process.stdout.write(label);
  return readLineSync().trim();
}

/** Drain piped stdin; returns "" when stdin is an interactive TTY. */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
