// What is on a sheet, and its layout in bytes. See SPEC.md, section 5.
//
// Part A (`Locked`) is the same on every sheet of a set: the locked secret
// and the details of the set. Part B (`Piece`) is that sheet's piece of the
// key.

import {SheetError} from './errors.ts';
import {KEY_BYTES, LOCKED_SIZES, NONCE_BYTES} from './locking.ts';
import {concat, toText} from './written.ts';

export const VERSION = 1;
export const MIN_SHEETS = 2;
export const MAX_SHEETS = 20;
export const MAX_LABEL_BYTES = 64;
const FINGERPRINT_BYTES = 8;
const PIECE_BYTES = 2 + KEY_BYTES;

export interface Piece {
  number: number; // which sheet: 1, 2, ...
  x: number; // the piece's coordinate
  y: Uint8Array;
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface Locked {
  needed: number;
  total: number;
  madeOn: CalendarDate;
  label: string;
  nonce: Uint8Array;
  locked: Uint8Array; // the encrypted secret and its tag
  fingerprints: Uint8Array[]; // of every piece in the set, in sheet order
}

export interface Sheet {
  locked: Locked;
  piece: Piece;
}

const ascii = (text: string) => new TextEncoder().encode(text);

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', concat(...parts) as BufferSource));
}

// ---- Part B ------------------------------------------------------------------

export function pieceBytes(piece: Piece): Uint8Array {
  return concat(Uint8Array.of(piece.number, piece.x), piece.y);
}

export function readPiece(data: Uint8Array): Piece {
  if (data.length !== PIECE_BYTES) throw new SheetError('malformed', {problem: 'piece-length'});
  if (data[0] === 0 || data[1] === 0) throw new SheetError('malformed', {problem: 'piece'});
  return {number: data[0]!, x: data[1]!, y: data.slice(2)};
}

export async function fingerprint(piece: Piece): Promise<Uint8Array> {
  const digest = await sha256(ascii('secret sheet piece v1'), Uint8Array.of(piece.x), piece.y);
  return digest.slice(0, FINGERPRINT_BYTES);
}

// ---- Part A ------------------------------------------------------------------

/** Everything about the set that comes before the locked secret. */
function details(locked: Locked): Uint8Array {
  const label = new TextEncoder().encode(locked.label);
  const {year, month, day} = locked.madeOn;
  return concat(
    Uint8Array.of(VERSION, locked.needed, locked.total, year >> 8, year & 0xff, month, day, label.length),
    label,
  );
}

/** What the encryption vouches for besides the secret (SPEC.md, 5.3). */
export function authenticated(locked: Locked): Uint8Array {
  return concat(details(locked), ...locked.fingerprints);
}

export function lockedBytes(locked: Locked): Uint8Array {
  const length = locked.locked.length;
  return concat(
    details(locked),
    locked.nonce,
    Uint8Array.of(length >> 8, length & 0xff),
    locked.locked,
    ...locked.fingerprints,
  );
}

/**
 * Twelve characters people can read to each other to confirm they hold
 * sheets from the same set.
 */
export async function setCode(locked: Locked): Promise<string> {
  const digest = await sha256(ascii('secret sheet set v1'), lockedBytes(locked));
  return toText(digest.subarray(0, 8)).slice(0, 12).match(/.{4}/g)!.join('-');
}

export function readLocked(data: Uint8Array): Locked {
  const [locked, rest] = takeLocked(data);
  if (rest.length > 0) throw new SheetError('malformed', {problem: 'too-long'});
  return locked;
}

/** Read Part A from the front of `data`; return it and what follows. */
function takeLocked(data: Uint8Array): [Locked, Uint8Array] {
  let at = 0;
  const take = (count: number): Uint8Array => {
    if (at + count > data.length) throw new SheetError('malformed', {problem: 'incomplete'});
    at += count;
    return data.slice(at - count, at);
  };
  const byte = () => take(1)[0]!;
  const twoBytes = () => (byte() << 8) | byte();
  const malformed = (problem: string) => new SheetError('malformed', {problem});

  const version = byte();
  if (version !== VERSION) throw new SheetError('unsupported-version', {version});
  const needed = byte();
  const total = byte();
  if (total < MIN_SHEETS || total > MAX_SHEETS || needed < 2 || needed > total) {
    throw malformed('numbers');
  }
  const madeOn = {year: twoBytes(), month: byte(), day: byte()};
  if (!isRealDate(madeOn)) throw malformed('date');
  const labelLength = byte();
  if (labelLength > MAX_LABEL_BYTES) throw malformed('label-length');
  const labelBytes = take(labelLength);
  let label: string;
  try {
    label = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(labelBytes);
  } catch {
    throw malformed('label');
  }
  if (!isPrintable(label)) throw malformed('label');
  const nonce = take(NONCE_BYTES);
  const lockedLength = twoBytes();
  if (!LOCKED_SIZES.includes(lockedLength)) throw malformed('size');
  const locked = take(lockedLength);
  const fingerprints = Array.from({length: total}, () => take(FINGERPRINT_BYTES));

  return [{needed, total, madeOn, label, nonce, locked, fingerprints}, data.subarray(at)];
}

/**
 * Whether `text` is free of control characters (line breaks, tabs and the
 * like), which have no place in a label printed on one line.
 */
export function isPrintable(text: string): boolean {
  return !/[\u0000-\u001f\u007f-\u009f]/.test(text);
}

function isRealDate({year, month, day}: CalendarDate): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

// ---- a whole sheet --------------------------------------------------------------

export function sheetBytes(sheet: Sheet): Uint8Array {
  return concat(lockedBytes(sheet.locked), pieceBytes(sheet.piece));
}

export function readSheetBytes(data: Uint8Array): Sheet {
  const [locked, rest] = takeLocked(data);
  return {locked, piece: readPiece(rest)};
}
