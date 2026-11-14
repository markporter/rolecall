// Shared CLI prompt helpers for interactive wizards.

import { createInterface } from "node:readline/promises";
import type { GlobalFlags } from "./types";

/** True when stdin/stdout are both TTYs and the flags do not force non-interactive mode. */
export function isInteractive(flags: GlobalFlags): boolean {
  const tty = process.stdin.isTTY === true && process.stdout.isTTY === true;
  return tty && flags.nonInteractive !== true && flags.yes !== true && flags.dryRun !== true;
}

/** Parse a yes/no answer, falling back when the answer is empty. */
export function yesNo(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (v === "") return fallback;
  return v === "y" || v === "yes" || v === "true" || v === "1";
}

/** Build an ask function, optionally injecting one for tests. */
export function createAsk(
  injected?: (question: string, fallback: string) => Promise<string>,
): (question: string, fallback: string) => Promise<string> {
  if (injected !== undefined) return injected;
  return async (question: string, fallback: string): Promise<string> => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const value = await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `);
      return value.trim() || fallback;
    } finally {
      rl.close();
    }
  };
}

/** Ask a yes/no question with a default. */
export async function confirm(
  ask: (question: string, fallback: string) => Promise<string>,
  question: string,
  fallback: boolean,
): Promise<boolean> {
  return yesNo(await ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`, ""), fallback);
}
