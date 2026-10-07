import {readFileSync} from 'node:fs';

export interface ValidCase {
  name: string;
  secret: string;
  needed: number;
  set_code: string;
  sheets: string[];
}

export interface InvalidCase {
  name: string;
  expect: string;
  sheets: string[];
}

export interface Vectors {
  format: number;
  valid: ValidCase[];
  invalid: InvalidCase[];
  typed: {
    part_a: string[];
    part_b: string[][];
    secret: string;
    as_people_type: {name: string; text: string}[];
    bad_lines: {name: string; line: string}[];
  };
}

// The same file the Python tests read.
export const vectors: Vectors = JSON.parse(
  readFileSync(new URL('../../tests/vectors/sheets_v1.json', import.meta.url), 'utf8'),
);

export function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

/** Bytes that look random but are the same on every run. */
export function repeatableBytes(count: number, seed: number): Uint8Array {
  let state = seed >>> 0 || 1;
  return Uint8Array.from({length: count}, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  });
}

export function flipped(data: Uint8Array, bit: number): Uint8Array {
  const changed = data.slice();
  changed[bit >> 3]! ^= 1 << (bit & 7);
  return changed;
}
