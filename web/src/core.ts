// Making a set of sheets from a secret, and getting the secret back.
//
// Making a set (SPEC.md, sections 3 to 5):
//   1. make a random key and lock the secret with it;
//   2. split the key into pieces, one per sheet;
//   3. put the locked secret and one piece on each sheet.
//
// The splitting is done by an independently audited library. Everything
// around it follows the Python version line for line, and the two are held
// to the same published test cases.
//
// Recovery is strict on purpose. Before anything is unlocked, every sheet
// must belong to the same set and every piece must match its fingerprint, so
// that when something is wrong the person is told which sheet. And nothing
// is ever returned unless the encryption itself accepted the rebuilt key.

import {combine, split} from 'shamir-secret-sharing';

import {SheetError} from './errors.ts';
import {KEY_BYTES, MAX_SECRET_BYTES, NONCE_BYTES, lock, unlock} from './locking.ts';
import {
  MAX_LABEL_BYTES,
  MAX_SHEETS,
  MIN_SHEETS,
  authenticated,
  fingerprint,
  isPrintable,
  lockedBytes,
  readLocked,
  readPiece,
  readSheetBytes,
  setCode,
  sheetBytes,
} from './sheet.ts';
import type {CalendarDate, Locked, Piece, Sheet} from './sheet.ts';
import {concat, fromQrText, isQrText, qrText, readTypedLines, sameBytes} from './written.ts';

/** Why a request to make a set was refused. The sentences are in strings.ts. */
export class Refusal extends Error {
  readonly reason:
    | 'no-secret'
    | 'secret-too-long'
    | 'unusable-characters'
    | 'label-too-long'
    | 'label-not-plain'
    | 'total'
    | 'needed';
  /** For a secret that is too long: how long it is, and the most a sheet holds. */
  readonly bytes: number;
  readonly limit = MAX_SECRET_BYTES;

  constructor(reason: Refusal['reason'], bytes = 0) {
    super(reason);
    this.name = 'Refusal';
    this.reason = reason;
    this.bytes = bytes;
  }
}

/**
 * Whether `text` can be written as UTF-8 and read back unchanged. A string
 * holding half of a surrogate pair cannot: the encoder quietly replaces it,
 * and the secret would come back different from what was typed.
 */
function survivesEncoding(text: string): boolean {
  const decoder = new TextDecoder('utf-8', {ignoreBOM: true});
  return decoder.decode(new TextEncoder().encode(text)) === text;
}

function today(): CalendarDate {
  const now = new Date();
  return {year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate()};
}

/**
 * Make `total` sheets, any `needed` of which recover `secret`.
 *
 * `label` is printed on every sheet for anyone to read, so it must not give
 * the secret away.
 */
export async function splitSecret(
  secret: string,
  needed: number,
  total: number,
  label = '',
  madeOn: CalendarDate = today(),
): Promise<Sheet[]> {
  if (!survivesEncoding(secret) || !survivesEncoding(label)) {
    throw new Refusal('unusable-characters');
  }
  const secretBytes = new TextEncoder().encode(secret);
  if (secretBytes.length === 0) throw new Refusal('no-secret');
  if (secretBytes.length > MAX_SECRET_BYTES) throw new Refusal('secret-too-long', secretBytes.length);
  if (new TextEncoder().encode(label).length > MAX_LABEL_BYTES) throw new Refusal('label-too-long');
  if (!isPrintable(label)) throw new Refusal('label-not-plain');
  if (!Number.isInteger(total) || total < MIN_SHEETS || total > MAX_SHEETS) throw new Refusal('total');
  if (!Number.isInteger(needed) || needed < 2 || needed > total) throw new Refusal('needed');

  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  // The library returns each piece as its bytes followed by its coordinate.
  const shares = await split(key, total, needed);
  const pieces: Piece[] = shares.map((share, i) => ({
    number: i + 1,
    x: share[KEY_BYTES]!,
    y: share.slice(0, KEY_BYTES),
  }));

  // The set's details and fingerprints are vouched for by the encryption,
  // so they have to exist before the secret is locked.
  const locked: Locked = {
    needed,
    total,
    madeOn,
    label,
    nonce,
    locked: new Uint8Array(),
    fingerprints: await Promise.all(pieces.map(fingerprint)),
  };
  locked.locked = await lock(key, nonce, secretBytes, authenticated(locked));
  key.fill(0);
  const sheets = pieces.map(piece => ({locked, piece}));

  // Never hand back sheets that have not been shown to work. Each one must
  // survive being written out and read back, and the secret must return
  // from the first sheets, from the last, and from all of them at once.
  let works: boolean;
  try {
    const reread = sheets.map(sheet => readSheet(qrText(sheetBytes(sheet))));
    works = reread.every((sheet, i) => sameBytes(sheetBytes(sheet), sheetBytes(sheets[i]!)));
    for (const some of [reread.slice(0, needed), reread.slice(-needed), reread]) {
      works &&= (await recoverSecret(some)) === secret;
    }
  } catch (problem) {
    if (!(problem instanceof SheetError)) throw problem;
    works = false;
  }
  if (!works) throw new Error('the new sheets failed their own recovery check');
  return sheets;
}

/**
 * The secret, from at least `needed` different sheets of one set.
 *
 * `extraPieces` are for sheets typed in by hand, where the person enters
 * Part A once and then only Part B of each other sheet.
 *
 * Throws a SheetError saying what is wrong, and with which sheet if that can
 * be known. The order of the checks is fixed (SPEC.md, section 7).
 */
export async function recoverSecret(sheets: Sheet[], extraPieces: Piece[] = []): Promise<string> {
  if (sheets.length === 0) throw new SheetError('too-few', {have: 0});
  const locked = await theOneSet(sheets);

  const pieces = new Map<number, Piece>();
  for (const piece of [...sheets.map(sheet => sheet.piece), ...extraPieces]) {
    const expected = locked.fingerprints[piece.number - 1];
    if (!expected) {
      throw new SheetError('wrong-piece', {sheets: [piece.number], total: locked.total});
    }
    if (!sameBytes(await fingerprint(piece), expected)) {
      throw new SheetError('wrong-piece', {sheets: [piece.number]});
    }
    pieces.set(piece.number, piece);
  }

  if (pieces.size < locked.needed) {
    throw new SheetError('too-few', {needed: locked.needed, have: pieces.size});
  }
  // Two sheets with different numbers but the same coordinate cannot come
  // from a set that was made properly.
  if (new Set([...pieces.values()].map(piece => piece.x)).size !== pieces.size) {
    throw new SheetError('malformed', {problem: 'coordinates'});
  }

  const shares = [...pieces.values()].map(piece => concat(piece.y, Uint8Array.of(piece.x)));
  const key = await combine(shares);
  try {
    const secret = await unlock(key, locked.nonce, locked.locked, authenticated(locked));
    return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(secret);
  } catch {
    // The encryption refused the key, or what it unlocked is not a padded
    // piece of text. Every piece matched its fingerprint, so Part A itself
    // must have been rewritten on every sheet given.
    throw new SheetError('cannot-unlock');
  } finally {
    key.fill(0);
  }
}

/** The Part A all the sheets share. Throws 'mixed-sets' if they don't. */
async function theOneSet(sheets: Sheet[]): Promise<Locked> {
  const votes = new Map<string, Sheet[]>();
  for (const sheet of sheets) {
    const partA = lockedBytes(sheet.locked).join(',');
    votes.set(partA, [...(votes.get(partA) ?? []), sheet]);
  }
  const groups = [...votes.values()].sort((a, b) => b.length - a.length);
  const [largest, runnerUp] = groups;
  if (!runnerUp) return largest![0]!.locked;

  if (largest!.length === runnerUp.length) {
    const codes = await Promise.all(groups.map(group => setCode(group[0]!.locked)));
    throw new SheetError('mixed-sets', {codes: codes.sort()});
  }
  const odd = groups.slice(1).flat().map(sheet => sheet.piece.number);
  throw new SheetError('mixed-sets', {sheets: odd.sort((a, b) => a - b)});
}

// ---- reading sheets from text ---------------------------------------------------

/**
 * Whatever `text` contains of a sheet: the QR code's text, or typed lines
 * (both parts, or only one).
 */
export function readParts(text: string): {locked?: Locked; piece?: Piece} {
  if (isQrText(text)) return readSheetBytes(fromQrText(text));
  const parts = readTypedLines(text);
  if (!parts.A && !parts.B) throw new SheetError('malformed', {problem: 'nothing-found'});
  return {
    ...(parts.A && {locked: readLocked(parts.A)}),
    ...(parts.B && {piece: readPiece(parts.B)}),
  };
}

/** A complete sheet from its text. Throws 'malformed' if a part is missing. */
export function readSheet(text: string): Sheet {
  const {locked, piece} = readParts(text);
  if (!locked) throw new SheetError('malformed', {problem: 'no-part-a'});
  if (!piece) throw new SheetError('malformed', {problem: 'no-part-b'});
  return {locked, piece};
}

// ---- checking one sheet -----------------------------------------------------------

export interface Checkup {
  intact: boolean;
  number: number;
  needed: number;
  total: number;
  madeOn: CalendarDate;
  label: string;
  setCode: string;
}

/**
 * What a sheet says about itself, and whether its piece is intact. Reveals
 * nothing about the secret.
 */
export async function checkSheet(sheet: Sheet): Promise<Checkup> {
  const {locked, piece} = sheet;
  const expected = locked.fingerprints[piece.number - 1];
  return {
    intact: expected !== undefined && sameBytes(await fingerprint(piece), expected),
    number: piece.number,
    needed: locked.needed,
    total: locked.total,
    madeOn: locked.madeOn,
    label: locked.label,
    setCode: await setCode(locked),
  };
}
