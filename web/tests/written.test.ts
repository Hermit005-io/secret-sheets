import assert from 'node:assert/strict';
import {test} from 'node:test';

import {SheetError} from '../src/errors.ts';
import {
  ALPHABET,
  crc10,
  fromQrText,
  fromText,
  qrText,
  readTypedLines,
  startsLikeALine,
  toText,
  typedLines,
} from '../src/written.ts';
import {randomBytes, repeatableBytes} from './helpers.ts';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

function badLine(run: () => unknown, line: string): void {
  assert.throws(run, (problem: unknown) => {
    return problem instanceof SheetError && problem.failure === 'bad-line' && problem.detail.line === line;
  });
}

test('bytes survive the trip to characters and back, at every length', () => {
  for (let length = 0; length <= 120; length++) {
    const data = randomBytes(length);
    const written = toText(data);
    assert.equal(written.length, Math.ceil((8 * length) / 5));
    assert.ok([...written].every(char => ALPHABET.includes(char)));
    assert.deepEqual(fromText(written), data);
  }
});

test('the same examples as the Python version', () => {
  assert.equal(toText(bytes()), '');
  assert.equal(toText(bytes(0x00)), '00');
  assert.equal(toText(bytes(0xff)), 'ZW');
  assert.equal(toText(text('hello')), 'D1JPRV3F');
});

test('common misreadings are accepted', () => {
  for (const typed of ['d1jprv3f', 'DIJPRV3F', 'DLJPRV3F']) {
    assert.deepEqual(fromText(typed), text('hello'));
  }
  assert.deepEqual(fromText('OO'), bytes(0));
});

test('text no bytes could have produced is refused', () => {
  for (const impossible of ['U0', '0!', '0', '000', '000000', 'ZZ', '01']) {
    assert.throws(() => fromText(impossible), impossible);
  }
});

test('the CRC matches the published check value', () => {
  assert.equal(crc10(text('123456789')), 0x199);
});

test('a line looks like the one in the specification', () => {
  const line = typedLines('A', Uint8Array.from({length: 10}, (_, i) => i))[0];
  assert.equal(line, 'A01  000G-40R4-0M30-E209  Y0');
});

test('typed lines survive the trip, at every length', () => {
  for (let length = 1; length <= 120; length++) {
    const data = randomBytes(length);
    const part = length % 2 ? 'A' : 'B';
    const lines = typedLines(part, data);
    assert.equal(lines.length, Math.ceil(length / 10));
    assert.deepEqual(readTypedLines(lines.join('\n')), {[part]: data});
  }
});

test('lines are found among other text however they are spaced', () => {
  const a = randomBytes(25);
  const b = randomBytes(34);
  const sheet = ['Secret sheet 2 of 5', '', ...typedLines('A', a), 'Part B', ...typedLines('B', b), 'A note.'].join('\r\n');
  assert.deepEqual(readTypedLines(sheet), {A: a, B: b});
  const untidy = sheet.toLowerCase().replaceAll('-', ' ').replace('a01  ', '   A01: ');
  assert.deepEqual(readTypedLines(untidy), {A: a, B: b});
  assert.deepEqual(readTypedLines('Nothing typed here.\nA1 is a road.'), {});
});

test('only plain letters and digits stand in for each other', () => {
  // JavaScript would upper-case ß to SS and ı to I. Neither is on a sheet.
  for (const foreign of ['ß0', 'ı0', 'ſ0', '٠0', '０0', 'Ｏ0']) {
    assert.throws(() => fromText(foreign), foreign);
  }
});

test('the ways people really type a line', () => {
  const data = Uint8Array.from({length: 34}, (_, i) => i + 100);
  const lines = typedLines('B', data);
  assert.ok(lines[1]!.startsWith('B02  '));
  for (const typed of [
    lines[1]!.replace(/[ -]/g, ''), // no spaces or dashes at all
    lines[1]!.replace('B02  ', 'B02:'), // a colon and no space
    lines[1]!.replace('B02', 'BO2'), // letter O in the line number
    lines[1]!.replace('B02', 'bo2'),
    `\t ${lines[1]} \t`,
  ]) {
    assert.deepEqual(readTypedLines([lines[0], typed, lines[2], lines[3]].join('\n')), {B: data}, typed);
  }
  assert.deepEqual(readTypedLines(lines.join('\n').replace('B01', 'B0l')), {B: data});
  // With no digit left at all it is taken for a word, and the line is missed by name.
  badLine(() => readTypedLines(lines.join('\n').replace('B01', 'BOl')), 'B01');

  for (const ending of ['\n', '\r\n', '\r']) {
    assert.deepEqual(readTypedLines('\ufeff' + lines.join(ending)), {B: data});
  }
});

test('words that merely begin like a line are left alone', () => {
  assert.deepEqual(readTypedLines('All of them.\nBill has one.\nA٠١ 0000\nBoo\nA01'), {});
});

test('telling whether words would be read as a line', () => {
  for (const words of ['B12 Vitamins', 'a07: x', '  A0l.x', 'notes\nB04 0']) {
    assert.equal(startsLikeALine(words), true, words);
  }
  for (const words of ['', 'B12', 'Bill has one', 'A1 is a road', 'Vitamin B12 Ltd', 'All 0000']) {
    assert.equal(startsLikeALine(words), false, words);
  }
});

test('only real line breaks end a line', () => {
  // U+2028 and U+2029 are "line separators" to some programs, JavaScript's
  // patterns among them. Here they are just characters no sheet contains.
  const lines = typedLines('B', Uint8Array.from({length: 34}, (_, i) => i));
  for (const separator of ['\u2028', '\u2029', '\x0b', '\x0c', '\x85']) {
    badLine(() => readTypedLines(lines.join(separator)), 'B01');
  }
});

test('a very long line is refused at once', () => {
  badLine(() => readTypedLines('A01 ' + '0'.repeat(400_000)), 'A01');
  assert.deepEqual(readTypedLines('A01' + ' '.repeat(400_000)), {});
});

const bodyOf = (line: string) => [line.slice(0, 3), line.slice(3).replace(/[ -]/g, '')] as const;
const tenBytes = new Uint8Array(10);

// A line of every length there can be, in each part. The data looks random
// but is the same on every run.
const linesOfEveryLength = (['A', 'B'] as const).flatMap(part =>
  Array.from({length: 10}, (_, i) => typedLines(part, Uint8Array.of(...tenBytes, ...repeatableBytes(i + 1, 1979 + i)))[1]!),
);

test('every single wrong character is caught on its line', () => {
  // Every position, the two check characters included, changed to each of
  // the 31 other characters.
  for (const line of linesOfEveryLength) {
    const [label, body] = bodyOf(line);
    for (let position = 0; position < body.length; position++) {
      for (const wrong of ALPHABET) {
        if (wrong === body[position]) continue;
        const changed = body.slice(0, position) + wrong + body.slice(position + 1);
        badLine(() => readTypedLines(`${label} ${changed}`), label);
      }
    }
  }
});

test('every swap of two neighbouring characters is caught', () => {
  for (const line of linesOfEveryLength) {
    const [label, body] = bodyOf(line);
    for (let position = 0; position < body.length - 1; position++) {
      const [left, right] = [body[position]!, body[position + 1]!];
      if (left === right) continue;
      const changed = body.slice(0, position) + right + left + body.slice(position + 2);
      badLine(() => readTypedLines(`${label} ${changed}`), label);
    }
  }
});

test('every pair of characters swapped is caught', () => {
  // The same, but with every possible pair of different characters put at
  // every pair of neighbouring places in the data, and the check worked out
  // afresh, so that no pair is left to chance.
  for (let length = 1; length <= 10; length++) {
    const count = toText(new Uint8Array(length)).length;
    for (let position = 0; position < count - 1; position++) {
      for (const left of ALPHABET) {
        for (const right of ALPHABET) {
          if (left === right) continue;
          const written = '0'.repeat(position) + left + right + '0'.repeat(count - position - 2);
          let data: Uint8Array;
          try {
            data = fromText(written);
          } catch {
            continue; // not a line a sheet could have: its filler bits are not zero
          }
          const [label, body] = bodyOf(typedLines('B', Uint8Array.of(...tenBytes, ...data))[1]!);
          const changed = body.slice(0, position) + right + left + body.slice(position + 2);
          badLine(() => readTypedLines(`${label} ${changed}`), label);
        }
      }
    }
  }
});

test('a wrong part letter or line number is caught', () => {
  for (const line of linesOfEveryLength) {
    const [label, body] = bodyOf(line);
    const other = label[0] === 'A' ? 'B' : 'A';
    badLine(() => readTypedLines(`${other}${label.slice(1)} ${body}`), other + label.slice(1));
    for (let number = 1; number < 100; number++) {
      if (number === 2) continue;
      const wrong = label[0] + String(number).padStart(2, '0');
      badLine(() => readTypedLines(`${wrong} ${body}`), wrong);
    }
  }
});

test('a line in the wrong place, missing, short or contradicted', () => {
  const lines = typedLines('B', Uint8Array.from({length: 34}, (_, i) => i));
  for (const wrong of ['B01', 'B03', 'A02']) {
    badLine(() => readTypedLines(wrong + lines[1]!.slice(3)), wrong);
  }
  badLine(() => readTypedLines([lines[0], lines[2], lines[3]].join('\n')), 'B02');
  badLine(() => readTypedLines(lines[1]!), 'B01');

  const short = [typedLines('B', new Uint8Array(4))[0], typedLines('B', new Uint8Array(20))[1]];
  badLine(() => readTypedLines(short.join('\n')), 'B01');

  const other = typedLines('B', Uint8Array.from({length: 34}, (_, i) => i + 1));
  badLine(() => readTypedLines([lines[0], other[0]].join('\n')), 'B01');
  assert.equal(readTypedLines([lines[0], ...lines].join('\n')).B?.length, 34);

  badLine(() => readTypedLines('B01  0'), 'B01');
  badLine(() => readTypedLines('B00  0000'), 'B00');
});

test('the QR text survives the trip and uses only QR alphanumeric characters', () => {
  for (const length of [1, 34, 196, 808]) {
    const data = randomBytes(length);
    const written = qrText(data);
    assert.match(written, /^SSR1:[0-9A-Z]+$/);
    assert.deepEqual(fromQrText(`  ${written.toLowerCase()}\n`), data);
  }
});

test('text that is not from a sheet', () => {
  for (const stranger of ['', 'https://example.com', 'SSR2:0000', 'SSR1:U', 'SSR1:000']) {
    assert.throws(
      () => fromQrText(stranger),
      (problem: unknown) => problem instanceof SheetError && problem.failure === 'malformed',
    );
  }
});
