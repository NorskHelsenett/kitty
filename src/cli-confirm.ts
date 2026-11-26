import * as readline from 'readline/promises';
import * as fs from 'fs';
import { stripControlChars } from './sanitize.js';

/**
 * Environment variable that approves every confirmation-gated tool call
 * without asking. Meant for CI and scripted runs where nobody can answer.
 */
export const AUTO_APPROVE_ENV = 'KITTY_AUTO_APPROVE';

export function isAutoApproveEnabled(): boolean {
  const value = (process.env[AUTO_APPROVE_ENV] || '').toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Confirmation used outside the TUI (non-interactive queries, `kitty agent run`).
 *
 * - With KITTY_AUTO_APPROVE=1 the call is approved, and the request is still
 *   printed to stderr so it shows up in logs.
 * - Otherwise, if a terminal is attached, the user is asked on /dev/tty (this
 *   works even when stdin is a pipe).
 * - With no terminal and no opt-in, the call is denied.
 */
export async function confirmOnTerminal(toolName: string, details: string): Promise<{ approved: boolean; reason?: string }> {
  const summary = stripControlChars(`Tool: ${toolName}\n${details}`.trim());

  if (isAutoApproveEnabled()) {
    process.stderr.write(`\n[kitty] ${AUTO_APPROVE_ENV} is set, approving:\n${summary}\n\n`);
    return { approved: true };
  }

  // Open the controlling terminal synchronously so a missing one is a plain
  // exception here rather than an unhandled stream 'error' event later.
  let inFd: number | null = null;
  let outFd: number | null = null;
  try {
    inFd = fs.openSync('/dev/tty', 'r');
    outFd = fs.openSync('/dev/tty', 'w');
  } catch {
    if (inFd !== null) fs.closeSync(inFd);
    return {
      approved: false,
      reason: `"${toolName}" needs confirmation, but no terminal is available to ask. Set ${AUTO_APPROVE_ENV}=1 to approve such calls without asking.`,
    };
  }

  const ttyIn = fs.createReadStream('', { fd: inFd });
  const ttyOut = fs.createWriteStream('', { fd: outFd });
  const rl = readline.createInterface({ input: ttyIn, output: ttyOut, terminal: true });
  try {
    ttyOut.write(`\nThe AI is requesting to execute the following tool:\n${summary}\n`);
    const answer = await rl.question('Allow? [y/N] ');
    const approved = /^y(es)?$/i.test(answer.trim());
    return approved ? { approved: true } : { approved: false, reason: 'Action cancelled by user' };
  } finally {
    rl.close();
    ttyIn.destroy();
    ttyOut.end();
  }
}
