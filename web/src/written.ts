// The written forms of a sheet: the text inside the QR code, and the lines a
// person can type by hand. See SPEC.md, section 6.
//
// A typed line looks like
//
//     A07  7KQ2-M9XH-T4C0-PZ3D  W0
//
// part and line number, ten bytes of data, and a check. The check is a CRC,
// which always catches a run of damaged bits no longer than itself. One
// mistyped character damages five bits in a row and two neighbouring
// characters swapped damage at most ten, so both are always caught, on the
// line where they happened.
//
// Reading is forgiving about how a person types (capitals or not, the letter
// O for zero, spacing, dashes) and about nothing else. Only the characters
// listed here are ever accepted: JavaScript's own idea of upper case or of a
// space takes in characters from other alphabets, which a sheet never has.

import {SheetError} from './errors.ts';

// 32 characters, leaving out I, L, O and U (easily confused with 1, 1, 0, V).
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const VALUES = new Map<string, number>([...ALPHABET].map((char, value) => [char, value]));
// What people type when they misread: letter O for zero, I or L for one.
VALUES.set('O', 0).set('I', 1).set('L', 1);
for (const [char, value] of [...VALUES]) VALUES.set(char.toLowerCase(), value);

export const QR_PREFIX = 'SSR1:';
export const BYTES_PER_LINE = 10;
const CHARACTERS_PER_LINE = 16; // ten bytes, five bits to a character
const CRC_POLYNOMIAL = 0x233; // CRC-10/ATM: x^10 + x^9 + x^5 + x^4 + x + 1

export type Part = 'A' | 'B';

// Ignored around a sheet's text.
const EDGES = /^[ \t\r\n\ufeff]+|[ \t\r\n\ufeff]+$/g;
// A typed line: part letter, two digits (or their look-alikes), then the rest.
// ("[^]" is any character at all; "." would stop at some that Unicode counts
// as ends of lines, though a sheet's lines end only where section 6.4 says.)
const LINE = /^([ABab])([0-9OoIiLl]{2})[ \t]*[:.]?[ \t]*([^]+)$/;
const LINE_ENDS = /\r\n|\r|\n/;

/** `text` without the spaces, line breaks and marks that may surround it. */
export function trimmed(text: string): string {
  return text.replace(EDGES, '');
}

/** Bytes as characters, five bits each, padded with zero bits at the end. */
export function toText(data: Uint8Array): string {
  let text = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) text += ALPHABET[(buffer << (5 - bits)) & 31];
  return text;
}

/**
 * The reverse of toText. Throws for a character outside the alphabet, a
 * length no number of bytes could produce, or filler bits that are not zero.
 */
export function fromText(text: string): Uint8Array {
  if ((5 * text.length) % 8 >= 5) throw new Error('an impossible number of characters');
  const bytes = new Uint8Array(Math.floor((5 * text.length) / 8));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (const char of text) {
    const value = VALUES.get(char);
    if (value === undefined) throw new Error('a character that is never used on a sheet');
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = buffer >> bits;
      buffer &= (1 << bits) - 1;
    }
  }
  if (buffer !== 0) throw new Error('the last character is not one a sheet could end with');
  return bytes;
}

export function crc10(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 2;
    for (let i = 0; i < 8; i++) {
      crc <<= 1;
      if (crc & 0x400) crc ^= 0x400 | CRC_POLYNOMIAL;
    }
  }
  return crc;
}

function check(part: Part, lineNumber: number, data: Uint8Array): string {
  const crc = crc10(Uint8Array.of(part.charCodeAt(0), lineNumber, ...data));
  return ALPHABET[crc >> 5]! + ALPHABET[crc & 31]!;
}

// ---- the QR code -------------------------------------------------------------

export function qrText(sheetBytes: Uint8Array): string {
  return QR_PREFIX + toText(sheetBytes);
}

/** Whether `text` starts the way a sheet's QR code does. */
export function isQrText(text: string): boolean {
  return /^SSR1:/i.test(trimmed(text));
}

export function fromQrText(text: string): Uint8Array {
  if (!isQrText(text)) throw new SheetError('malformed', {problem: 'not-a-sheet'});
  try {
    return fromText(trimmed(text).slice(QR_PREFIX.length));
  } catch {
    throw new SheetError('malformed', {problem: 'damaged-code'});
  }
}

// ---- typed lines -------------------------------------------------------------

/** `data` as the lines printed on a sheet for part A or B. */
export function typedLines(part: Part, data: Uint8Array): string[] {
  const lines: string[] = [];
  for (let start = 0; start < data.length; start += BYTES_PER_LINE) {
    const lineNumber = start / BYTES_PER_LINE + 1;
    const chunk = data.subarray(start, start + BYTES_PER_LINE);
    const groups = toText(chunk).match(/.{1,4}/g)!.join('-');
    const label = part + String(lineNumber).padStart(2, '0');
    lines.push(`${label}  ${groups}  ${check(part, lineNumber, chunk)}`);
  }
  return lines;
}

/**
 * Pick the typed lines out of `text` (a whole sheet, instructions and all)
 * and return the bytes of each part found.
 *
 * Anything that doesn't start like a typed line is ignored. A line that
 * does, but fails its check, is a 'bad-line' error naming the line.
 */
/**
 * The pieces of `line` if it starts like a typed line: A or B, then two
 * digits. Look-alikes may stand for the digits, but not for both of them, or
 * words such as "All" would be taken for lines.
 */
function asTypedLine(line: string): RegExpExecArray | null {
  const found = LINE.exec(trimmed(line));
  return found && /[0-9]/.test(found[2]!) ? found : null;
}

/** Whether any line of `text` would be read as a typed line of a sheet. */
export function startsLikeALine(text: string): boolean {
  return text.split(LINE_ENDS).some(line => asTypedLine(line) !== null);
}

export function readTypedLines(text: string): Partial<Record<Part, Uint8Array>> {
  const chunks: Record<Part, Map<number, Uint8Array>> = {A: new Map(), B: new Map()};

  for (const line of text.split(LINE_ENDS)) {
    const found = asTypedLine(line);
    if (!found) continue;
    const part = found[1]!.toUpperCase() as Part;
    const digits = found[2]!.replace(/[Oo]/g, '0').replace(/[IiLl]/g, '1');
    const lineNumber = Number(digits);
    const label = part + digits;
    const bad = (problem: string) => new SheetError('bad-line', {line: label, problem});

    // Counted as characters, not as JavaScript's units of a string, which
    // are two to a character for some.
    const body = [...found[3]!.replace(/[ \t-]/g, '')];
    if (lineNumber === 0 || body.length < 3) throw bad('incomplete');
    if (body.length > CHARACTERS_PER_LINE + 2) throw bad('mistake');
    let chunk: Uint8Array;
    try {
      chunk = fromText(body.slice(0, -2).join(''));
    } catch {
      throw bad('mistake');
    }
    const typedCheck = body.slice(-2).map(char => ALPHABET[VALUES.get(char) ?? -1] ?? '?').join('');
    if (typedCheck !== check(part, lineNumber, chunk)) throw bad('mistake');
    const earlier = chunks[part].get(lineNumber);
    if (earlier && !sameBytes(earlier, chunk)) throw bad('twice');
    chunks[part].set(lineNumber, chunk);
  }

  const parts: Partial<Record<Part, Uint8Array>> = {};
  for (const part of ['A', 'B'] as const) {
    const byNumber = chunks[part];
    if (byNumber.size === 0) continue;
    const count = Math.max(...byNumber.keys());
    const label = (n: number) => part + String(n).padStart(2, '0');
    for (let n = 1; n <= count; n++) {
      if (!byNumber.has(n)) throw new SheetError('bad-line', {line: label(n), problem: 'missing'});
    }
    for (let n = 1; n < count; n++) {
      if (byNumber.get(n)!.length !== BYTES_PER_LINE) {
        throw new SheetError('bad-line', {line: label(n), problem: 'short'});
      }
    }
    parts[part] = concat(...Array.from({length: count}, (_, i) => byNumber.get(i + 1)!));
  }
  return parts;
}

// ---- small helpers used across the modules ------------------------------------

export function concat(...arrays: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let at = 0;
  for (const array of arrays) {
    joined.set(array, at);
    at += array.length;
  }
  return joined;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
