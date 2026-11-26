/**
 * Helpers for writing untrusted text (model output, tool output, API error
 * bodies, plugin metadata) to the terminal.
 *
 * Terminals interpret raw control bytes: ESC starts CSI/OSC sequences that can
 * move the cursor, clear the screen, set the window title, write the clipboard
 * (OSC 52) or inject hyperlinks (OSC 8). Bidi override characters can make the
 * text a user reads differ from what is executed. Strip both before display.
 */

// C0 controls except TAB (0x09) and LF (0x0A), plus DEL and the C1 range
// (0x80-0x9F, which includes the 8-bit CSI 0x9B).
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// Unicode bidi embedding/override/isolate controls
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

/**
 * Remove terminal control characters from untrusted text, keeping tabs and
 * newlines. CRLF is normalised to LF first so line breaks survive.
 */
export function stripControlChars(text: string): string {
  if (!text) return text;
  return text
    .replace(/\r\n/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_CONTROLS, '');
}

/**
 * Like stripControlChars, but for values of unknown type.
 */
export function sanitizeForTerminal(value: unknown): string {
  if (value === null || value === undefined) return '';
  return stripControlChars(typeof value === 'string' ? value : String(value));
}
