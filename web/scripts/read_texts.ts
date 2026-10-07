// Reads a list of texts on standard input and writes how the web version
// reads each one: the bytes of the parts found, or the kind of failure and
// the line it names. tools/cross_reading.py compares the answers with the
// Python version's.

import {readParts} from '../src/core.ts';
import {SheetError} from '../src/errors.ts';
import {lockedBytes, pieceBytes} from '../src/sheet.ts';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

const answers = (JSON.parse(input) as string[]).map(text => {
  try {
    const {locked, piece} = readParts(text);
    return `${locked ? hex(lockedBytes(locked)) : '-'} ${piece ? hex(pieceBytes(piece)) : '-'}`;
  } catch (problem) {
    if (!(problem instanceof SheetError)) throw problem;
    return `refused: ${problem.failure} ${problem.detail.line ?? ''}`.trim();
  }
});

console.log(JSON.stringify(answers));
