import assert from 'node:assert/strict';
import {test} from 'node:test';

import {splitSecret} from '../src/core.ts';
import {SheetError} from '../src/errors.ts';
import {readSheetBytes, sheetBytes} from '../src/sheet.ts';
import {randomBytes} from './helpers.ts';

const DAY = {year: 2026, month: 10, day: 7};
const SHEETS = await splitSecret('correct horse battery staple', 3, 5, 'Email recovery codes', DAY);
const BYTES = sheetBytes(SHEETS[0]!);

function refusal(data: Uint8Array): SheetError {
  try {
    readSheetBytes(data);
  } catch (problem) {
    if (problem instanceof SheetError) return problem;
    throw problem;
  }
  assert.fail('the bytes were accepted as a sheet');
}

function changed(position: number, value: number): Uint8Array {
  const data = BYTES.slice();
  data[position < 0 ? data.length + position : position] = value;
  return data;
}

test('bytes survive the trip, and the layout matches the specification', () => {
  for (const sheet of SHEETS) assert.deepEqual(readSheetBytes(sheetBytes(sheet)), sheet);

  const data = sheetBytes(SHEETS[1]!);
  const label = new TextEncoder().encode('Email recovery codes');
  assert.deepEqual([...data.subarray(0, 8)], [1, 3, 5, 0x07, 0xea, 10, 7, label.length]);
  assert.deepEqual(data.subarray(8, 28), label);
  assert.deepEqual([...data.subarray(40, 42)], [0, 80]);
  assert.equal(data.length, 28 + 12 + 2 + 80 + 5 * 8 + 34);
  assert.equal(data.at(-34), 2); // sheet 2
});

test('the locked secret comes in four sizes', async () => {
  for (const [length, size] of [[1, 80], [62, 80], [63, 144], [126, 144], [127, 272], [254, 272], [255, 528], [510, 528]] as const) {
    const [sheet] = await splitSecret('s'.repeat(length), 2, 2);
    assert.equal(sheet!.locked.locked.length, size);
  }
});

test('a sheet cut short anywhere is refused', () => {
  for (let length = 0; length < BYTES.length; length++) {
    assert.equal(refusal(BYTES.subarray(0, length)).failure, 'malformed', `length ${length}`);
  }
  assert.equal(refusal(Uint8Array.of(...BYTES, 0)).failure, 'malformed');
});

test('impossible details are refused', () => {
  const cases: [number, number, string][] = [
    [1, 1, 'numbers'], // needed = 1
    [1, 6, 'numbers'], // needed > total
    [2, 21, 'numbers'], // total too large
    [5, 13, 'date'], // month 13
    [6, 0, 'date'], // day 0
    [6, 32, 'date'], // 32 October
    [3, 0x27, 'date'], // the year 10,218
    [7, 65, 'label-length'],
    [8, 0xff, 'label'], // not UTF-8
    [8, 0x0a, 'label'], // a line break, which could pose as more lines of the sheet
    [8, 0x1b, 'label'],
    [8, 0x7f, 'label'],
    [41, 81, 'size'], // a locked secret of an impossible length
    [-34, 0, 'piece'], // sheet number 0
    [-33, 0, 'piece'], // coordinate 0
  ];
  for (const [position, value, problem] of cases) {
    const found = refusal(changed(position, value));
    assert.equal(found.failure, 'malformed');
    assert.equal(found.detail.problem, problem, `position ${position}`);
  }
});

test('29 February only exists in leap years', async () => {
  const [leap] = await splitSecret('x', 2, 2, '', {year: 2028, month: 2, day: 29});
  assert.deepEqual(readSheetBytes(sheetBytes(leap!)).locked.madeOn, {year: 2028, month: 2, day: 29});
  const data = sheetBytes(leap!);
  data[4] = 0xeb; // 2027
  assert.equal(refusal(data).detail.problem, 'date');
});

test('another format version is named as such', () => {
  for (const version of [0, 2, 255]) {
    const found = refusal(changed(0, version));
    assert.equal(found.failure, 'unsupported-version');
    assert.equal(found.detail.version, version);
  }
});

test('scribbled-on sheets and arbitrary bytes never cause anything but a plain refusal', () => {
  for (let trial = 0; trial < 3000; trial++) {
    const data = trial % 3 === 0 ? randomBytes(trial % 400) : BYTES.slice(0, trial % 7 === 0 ? trial % 196 : 196);
    if (trial % 3 !== 0) {
      for (let edit = 0; edit < 1 + (trial % 5); edit++) {
        data[Math.floor(Math.random() * data.length)] = Math.floor(Math.random() * 256);
      }
    }
    try {
      readSheetBytes(data);
    } catch (problem) {
      assert.ok(problem instanceof SheetError, String(problem));
    }
  }
});
