import assert from 'node:assert/strict';
import {test} from 'node:test';

import {Refusal, checkSheet, readParts, readSheet, recoverSecret, splitSecret} from '../src/core.ts';
import {SheetError} from '../src/errors.ts';
import type {Failure} from '../src/errors.ts';
import {lock, pad, unlock, unpad} from '../src/locking.ts';
import {fingerprint, lockedBytes, readSheetBytes, setCode, sheetBytes} from '../src/sheet.ts';
import type {Sheet} from '../src/sheet.ts';
import {qrText, typedLines} from '../src/written.ts';
import {flipped, randomBytes, vectors} from './helpers.ts';

const SECRET = 'correct horse battery staple';
const SHEETS = await splitSecret(SECRET, 3, 5, 'Email recovery codes');

async function failure(run: () => Promise<unknown>): Promise<Failure | 'no failure'> {
  try {
    await run();
    return 'no failure';
  } catch (problem) {
    if (problem instanceof SheetError) return problem.failure;
    throw problem;
  }
}

/** Try a recovery from raw sheets: the name of the refusal, or the secret. */
async function outcome(raw: Uint8Array[]): Promise<string> {
  try {
    return await recoverSecret(raw.map(readSheetBytes));
  } catch (problem) {
    if (problem instanceof SheetError) return problem.failure;
    throw problem;
  }
}

// ---- splitting and recovering ----------------------------------------------------

test('any selection of enough sheets recovers the secret', async () => {
  for (const [needed, total] of [[2, 2], [2, 3], [3, 5], [5, 5], [2, 20], [20, 20], [7, 12]] as const) {
    const sheets = await splitSecret(SECRET, needed, total);
    assert.equal(sheets.length, total);
    for (let trial = 0; trial < 5; trial++) {
      const shuffled = [...sheets].sort(() => Math.random() - 0.5);
      const count = needed + Math.floor(Math.random() * (total - needed + 1));
      assert.equal(await recoverSecret(shuffled.slice(0, count)), SECRET);
    }
  }
});

test('the secret comes back exactly as typed', async () => {
  for (const secret of ['  spaces at both ends  ', 'tab\tand\nnew line', 'pässwörd ключ 密碼 🔑', 'é and é', '﻿starts with a byte order mark']) {
    assert.equal(await recoverSecret((await splitSecret(secret, 2, 3)).slice(1)), secret);
  }
});

test('order and repeats do not matter', async () => {
  const [a, b, c, d, e] = SHEETS as [Sheet, Sheet, Sheet, Sheet, Sheet];
  assert.equal(await recoverSecret([e, a, c]), SECRET);
  assert.equal(await recoverSecret([b, b, d, a, d]), SECRET);
  assert.equal(await recoverSecret(SHEETS), SECRET);
});

test('two sets from one secret have nothing in common', async () => {
  const again = await splitSecret(SECRET, 3, 5, 'Email recovery codes');
  assert.notDeepEqual(again[0]!.locked.locked, SHEETS[0]!.locked.locked);
  assert.notDeepEqual(again[0]!.piece.y, SHEETS[0]!.piece.y);
  assert.notEqual(await setCode(again[0]!.locked), await setCode(SHEETS[0]!.locked));
});

test('impossible requests are refused with a reason', async () => {
  const cases: [string, number, number, string, Refusal['reason']][] = [
    ['', 2, 3, '', 'no-secret'],
    ['x'.repeat(511), 2, 3, '', 'secret-too-long'],
    ['é'.repeat(256), 2, 3, '', 'secret-too-long'],
    ['secret', 2, 3, 'x'.repeat(65), 'label-too-long'],
    ['secret', 1, 3, '', 'needed'],
    ['secret', 4, 3, '', 'needed'],
    ['secret', 2.5, 3, '', 'needed'],
    ['secret', 2, 1, '', 'total'],
    ['secret', 2, 21, '', 'total'],
    ['half a \ud83d character', 2, 3, '', 'unusable-characters'],
    ['secret', 2, 3, 'half a \ud83d character', 'unusable-characters'],
    ['secret', 2, 3, 'two\nlines', 'label-not-plain'],
    ['secret', 2, 3, 'a\ttab', 'label-not-plain'],
  ];
  for (const [secret, needed, total, label, reason] of cases) {
    await assert.rejects(
      splitSecret(secret, needed, total, label),
      (problem: unknown) => problem instanceof Refusal && problem.reason === reason,
      `${reason}: ${secret.slice(0, 12)}`,
    );
  }
});

// ---- when something is wrong -------------------------------------------------------

test('too few sheets', async () => {
  await assert.rejects(recoverSecret(SHEETS.slice(0, 2)), (problem: SheetError) => {
    return problem.failure === 'too-few' && problem.detail.needed === 3 && problem.detail.have === 2;
  });
  assert.equal(await failure(() => recoverSecret([SHEETS[0]!, SHEETS[0]!])), 'too-few');
  assert.equal(await failure(() => recoverSecret([])), 'too-few');
});

test('a sheet from another set is named', async () => {
  const other = await splitSecret('something else', 3, 5, 'Email recovery codes');
  await assert.rejects(recoverSecret([SHEETS[0]!, SHEETS[1]!, other[3]!]), (problem: SheetError) => {
    return problem.failure === 'mixed-sets' && problem.detail.sheets?.join() === '4';
  });
  await assert.rejects(
    recoverSecret([SHEETS[0]!, other[1]!, SHEETS[2]!, other[3]!, SHEETS[4]!]),
    (problem: SheetError) => problem.failure === 'mixed-sets' && problem.detail.sheets?.join() === '2,4',
  );
  // One sheet from each: no telling which is the odd one, so both codes are given.
  const codes = [await setCode(SHEETS[0]!.locked), await setCode(other[0]!.locked)].sort();
  await assert.rejects(recoverSecret([SHEETS[0]!, other[1]!]), (problem: SheetError) => {
    return problem.failure === 'mixed-sets' && problem.detail.codes?.join() === codes.join();
  });
});

test('a damaged piece is named', async () => {
  const {locked, piece} = SHEETS[3]!;
  const damaged = {locked, piece: {...piece, y: new Uint8Array(32)}};
  await assert.rejects(recoverSecret([SHEETS[0]!, SHEETS[1]!, damaged]), (problem: SheetError) => {
    return problem.failure === 'wrong-piece' && problem.detail.sheets?.join() === '4';
  });
  const beyond = {locked, piece: {number: 9, x: 9, y: piece.y}};
  await assert.rejects(recoverSecret([SHEETS[0]!, SHEETS[1]!, beyond]), (problem: SheetError) => {
    return problem.failure === 'wrong-piece' && problem.detail.total === 5;
  });
});

test('no single flipped bit on one sheet ever gives a wrong secret', async () => {
  const good = SHEETS.slice(0, 2).map(sheetBytes);
  const target = sheetBytes(SHEETS[2]!);
  const allowed = new Set(['mixed-sets', 'wrong-piece', 'malformed', 'unsupported-version']);
  const seen = new Set<string>();
  for (let bit = 0; bit < 8 * target.length; bit++) {
    const result = await outcome([...good, flipped(target, bit)]);
    assert.ok(allowed.has(result), `bit ${bit}: ${result}`);
    seen.add(result);
  }
  assert.deepEqual(seen, allowed);
});

test('no flipped bit copied onto every sheet ever gives a wrong secret', async () => {
  // The same change made to Part A of all three sheets, so they still agree
  // with each other. Now only the encryption can notice.
  const partA = lockedBytes(SHEETS[0]!.locked).length;
  const allowed = new Set(['cannot-unlock', 'wrong-piece', 'malformed', 'unsupported-version', 'too-few']);
  const seen = new Set<string>();
  for (let bit = 0; bit < 8 * partA; bit++) {
    const result = await outcome(SHEETS.slice(0, 3).map(sheet => flipped(sheetBytes(sheet), bit)));
    assert.ok(allowed.has(result), `bit ${bit}: ${result}`);
    seen.add(result);
  }
  assert.ok(seen.has('cannot-unlock'));
});

test('changing the label or date on every sheet is caught', async () => {
  const old = SHEETS[0]!.locked;
  for (const forged of [{...old, label: 'Bank'}, {...old, madeOn: {year: 2020, month: 1, day: 1}}]) {
    const sheets = SHEETS.slice(0, 3).map(sheet => ({locked: forged, piece: sheet.piece}));
    assert.equal(await failure(() => recoverSecret(sheets)), 'cannot-unlock');
  }
});

// ---- reading sheets from text ------------------------------------------------------

test('the QR text and the typed lines give the same sheet', () => {
  const sheet = SHEETS[1]!;
  const typed = [...typedLines('A', lockedBytes(sheet.locked)), ...typedLines('B', sheetBytes(sheet).slice(-34))];
  assert.deepEqual(readSheet(qrText(sheetBytes(sheet))), sheet);
  assert.deepEqual(readSheet(typed.join('\n')), sheet);
});

test('Part A typed once and Part B from each other sheet', async () => {
  const first = readSheet(qrText(sheetBytes(SHEETS[0]!)));
  const others = SHEETS.slice(2, 4).map(sheet => {
    const {locked, piece} = readParts(typedLines('B', sheetBytes(sheet).slice(-34)).join('\n'));
    assert.equal(locked, undefined);
    return piece!;
  });
  assert.equal(await recoverSecret([first], others), SECRET);

  const stranger = (await splitSecret('something else', 3, 5))[1]!.piece;
  await assert.rejects(recoverSecret([first], [others[0]!, stranger]), (problem: SheetError) => {
    return problem.failure === 'wrong-piece' && problem.detail.sheets?.join() === '2';
  });
});

test('a sheet with a part missing says which', () => {
  const partB = typedLines('B', sheetBytes(SHEETS[0]!).slice(-34)).join('\n');
  const partA = typedLines('A', lockedBytes(SHEETS[0]!.locked)).join('\n');
  assert.throws(() => readSheet(partB), (problem: SheetError) => problem.detail.problem === 'no-part-a');
  assert.throws(() => readSheet(partA), (problem: SheetError) => problem.detail.problem === 'no-part-b');
});

test('text with no sheet in it says so', () => {
  for (const nothing of ['', '   \n', 'hello', 'A1 is a road.\nAll of it.']) {
    assert.throws(() => readParts(nothing), (problem: SheetError) => problem.detail.problem === 'nothing-found');
  }
});

test('a piece numbered outside the set is refused', async () => {
  const {locked, piece} = SHEETS[4]!;
  for (const number of [0, 6]) {
    const stray = {locked, piece: {...piece, number}};
    assert.equal((await checkSheet(stray)).intact, false);
    assert.equal(await failure(() => recoverSecret([SHEETS[0]!, SHEETS[1]!, stray])), 'wrong-piece');
  }
});

test('new sheets are read back before they are handed over', async () => {
  // A date that cannot be written on a sheet and read again: nothing is returned.
  await assert.rejects(splitSecret('x', 2, 2, '', {year: 2026, month: 2, day: 30}), /recovery check/);
});

test('checking a sheet reveals its details and nothing else', async () => {
  const report = await checkSheet(SHEETS[2]!);
  assert.equal(report.intact, true);
  assert.deepEqual([report.number, report.needed, report.total], [3, 3, 5]);
  assert.equal(report.label, 'Email recovery codes');
  assert.equal(report.setCode, await setCode(SHEETS[0]!.locked));
  assert.match(report.setCode, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  const {locked, piece} = SHEETS[2]!;
  assert.equal((await checkSheet({locked, piece: {...piece, y: new Uint8Array(32)}})).intact, false);
  assert.equal((await checkSheet({locked, piece: {...piece, number: 6}})).intact, false);
});

// ---- padding and locking ------------------------------------------------------------

test('padding sizes, and blocks that are not padded secrets', () => {
  for (const [length, size] of [[1, 64], [62, 64], [63, 128], [126, 128], [127, 256], [510, 512]] as const) {
    const secret = new Uint8Array(length).fill(115);
    assert.equal(pad(secret).length, size);
    assert.deepEqual(unpad(pad(secret)), secret);
  }
  assert.throws(() => pad(new Uint8Array(0)));
  assert.throws(() => pad(new Uint8Array(511)));

  const hello = [0, 5, 104, 101, 108, 108, 111];
  const bad = [
    new Uint8Array(64), // says the secret is empty
    Uint8Array.from([...hello, ...new Array(56).fill(0), 1]), // something after the secret
    Uint8Array.from([...hello, ...new Array(50).fill(0)]), // not one of the four sizes
    Uint8Array.from([0, 127, ...new Array(62).fill(120)]), // claims more than the block holds
  ];
  for (const block of bad) assert.throws(() => unpad(block));
});

test('unlocking needs the same key and the same details', async () => {
  const [key, nonce] = [randomBytes(32), randomBytes(12)];
  const secret = new TextEncoder().encode('secret');
  const details = new TextEncoder().encode('details');
  const locked = await lock(key, nonce, secret, details);
  assert.equal(locked.length, 80);
  assert.deepEqual(await unlock(key, nonce, locked, details), secret);
  await assert.rejects(unlock(randomBytes(32), nonce, locked, details));
  await assert.rejects(unlock(key, nonce, locked, new TextEncoder().encode('other details')));
  await assert.rejects(unlock(key, nonce, flipped(locked, 3), details));
});

// ---- the published test cases, shared with the Python version --------------------------

for (const published of vectors.valid) {
  test(`published set: ${published.name}`, async () => {
    const sheets = published.sheets.map(readSheet);
    const {needed, secret} = published;
    assert.equal(await setCode(sheets[0]!.locked), published.set_code);
    assert.equal(await recoverSecret(sheets.slice(0, needed)), secret);
    assert.equal(await recoverSecret(sheets.slice(-needed)), secret);
    assert.equal(await recoverSecret(sheets), secret);
    // And writing them out again gives back the same text, character for character.
    assert.deepEqual(sheets.map(sheet => qrText(sheetBytes(sheet))), published.sheets);
    for (const sheet of sheets) {
      assert.deepEqual(await fingerprint(sheet.piece), sheet.locked.fingerprints[sheet.piece.number - 1]);
    }
  });
}

for (const published of vectors.invalid) {
  test(`published damage: ${published.name}`, async () => {
    const result = await failure(async () => recoverSecret(published.sheets.map(readSheet)));
    assert.equal(result, published.expect);
  });
}

test('published typed lines', async () => {
  const {part_a, part_b, secret, bad_lines} = vectors.typed;
  const first = readSheet([...part_a, ...part_b[0]!].join('\n'));
  const pieces = part_b.slice(1, 3).map(lines => readParts(lines.join('\n')).piece!);
  assert.equal(await recoverSecret([first], pieces), secret);
  assert.deepEqual(typedLines('A', lockedBytes(first.locked)), part_a);
  for (const {name, text} of vectors.typed.as_people_type) {
    assert.deepEqual(sheetBytes(readSheet(text)), sheetBytes(first), name);
  }
  for (const bad of bad_lines) {
    assert.equal(await failure(async () => readParts(bad.line)), 'bad-line', bad.name);
  }
});
