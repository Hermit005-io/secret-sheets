// Prints sets made by the web version, as JSON, for the Python version to
// recover (tools/cross_versions.py):
//
//     node scripts/make_sets.ts 200

import {splitSecret} from '../src/core.ts';
import {lockedBytes, pieceBytes, sheetBytes} from '../src/sheet.ts';
import {qrText, typedLines} from '../src/written.ts';

const count = Number(process.argv[2] ?? 200);
const pick = (from: number, to: number) => from + Math.floor(Math.random() * (to - from + 1));

// Secrets drawn from several scripts, so that more than ASCII is exercised.
const letters = [...'abcXYZ 0189 .,!? äöüß éèñ ключ 密碼 かな 🔑🌍'];
const randomText = (length: number) =>
  Array.from({length}, () => letters[pick(0, letters.length - 1)]).join('');

const sets = [];
for (let i = 0; i < count; i++) {
  const total = pick(2, 20);
  const needed = pick(2, total);
  const secret = randomText(pick(1, i % 10 === 0 ? 120 : 40));
  const sheets = await splitSecret(secret, needed, total, randomText(pick(0, 12)));
  sets.push({
    secret,
    needed,
    // Half as the QR text, half as the lines a person would type.
    sheets: sheets.map(sheet =>
      i % 2 === 0
        ? qrText(sheetBytes(sheet))
        : [...typedLines('A', lockedBytes(sheet.locked)), ...typedLines('B', pieceBytes(sheet.piece))].join('\n'),
    ),
  });
}
console.log(JSON.stringify({sets}));
