// Prints test cases made by the audited library, as JSON:
//
//     node library_split.mjs 300 > ../tests/vectors/library_shares.json
//
// Each case is a random secret, a rule, and the shares the library made for
// it. A share is the piece's bytes followed by one byte for its x coordinate.

import {randomBytes, randomInt} from 'node:crypto';
import {split} from 'shamir-secret-sharing';

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const count = Number(process.argv[2] ?? 300);

const cases = [];
for (let i = 0; i < count; i++) {
  const total = randomInt(2, 13);
  const needed = randomInt(2, total + 1);
  // Mostly 32 bytes, the size of the key this project splits.
  const length = i % 4 === 0 ? randomInt(1, 65) : 32;
  const secret = randomBytes(length);
  const shares = await split(new Uint8Array(secret), total, needed);
  cases.push({secret: hex(secret), needed, shares: shares.map(hex)});
}

console.log(JSON.stringify({library: 'shamir-secret-sharing@0.0.4', cases}));
