// Reads cases in the same format on standard input, where the shares were
// made by the Python code, and checks that the audited library rebuilds each
// secret from them. Exits with an error if any case fails.

import {combine} from 'shamir-secret-sharing';

const bytes = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));

let input = '';
for await (const chunk of process.stdin) input += chunk;
const {cases} = JSON.parse(input);

let failures = 0;
for (const [index, {secret, needed, shares}] of cases.entries()) {
  // Exactly `needed` shares, then all of them.
  for (const chosen of [shares.slice(0, needed), shares]) {
    const rebuilt = Buffer.from(await combine(chosen.map(bytes))).toString('hex');
    if (rebuilt !== secret) {
      failures++;
      console.error(`case ${index}: expected ${secret}, the library rebuilt ${rebuilt}`);
      break;
    }
  }
}

console.log(`${cases.length - failures} of ${cases.length} cases rebuilt correctly by the library`);
process.exit(failures ? 1 : 0);
