// Reads sets in the same format on standard input, made by the Python
// version, and recovers each one with the web version. Exits with an error
// if any secret comes back different.

import {readSheet, recoverSecret} from '../src/core.ts';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const {sets} = JSON.parse(input) as {sets: {secret: string; needed: number; sheets: string[]}[]};

let failures = 0;
for (const [index, {secret, needed, sheets}] of sets.entries()) {
  try {
    const read = sheets.map(readSheet);
    // The last `needed` sheets, then all of them.
    const recovered = [await recoverSecret(read.slice(-needed)), await recoverSecret(read)];
    if (recovered.some(text => text !== secret)) throw new Error('a different secret came back');
  } catch (problem) {
    failures++;
    console.error(`set ${index}: ${problem}`);
  }
}

console.log(`${sets.length - failures} of ${sets.length} sets recovered correctly by the web version`);
process.exit(failures ? 1 : 0);
