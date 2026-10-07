// What can be wrong with sheets. The names are part of the format (SPEC.md,
// section 7): the test cases shared with the Python version say which name
// each damaged sheet must produce.

export type Failure =
  | 'bad-line'
  | 'malformed'
  | 'unsupported-version'
  | 'mixed-sets'
  | 'wrong-piece'
  | 'too-few'
  | 'cannot-unlock';

// The particulars a message needs: which line, which sheet, how many.
// The sentences themselves live in strings.ts.
export interface Detail {
  line?: string;
  problem?: string;
  sheets?: number[];
  codes?: string[];
  needed?: number;
  have?: number;
  total?: number;
  version?: number;
}

export class SheetError extends Error {
  readonly failure: Failure;
  readonly detail: Detail;

  constructor(failure: Failure, detail: Detail = {}) {
    super(failure);
    this.name = 'SheetError';
    this.failure = failure;
    this.detail = detail;
  }
}
