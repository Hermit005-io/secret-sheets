// Gathering sheets until there are enough, then recovering the secret. The
// recovery screen is this and little else; the "prove they work" step after
// making a set uses it too.

import {checkSheet, recoverSecret} from '../core.ts';
import {SheetError} from '../errors.ts';
import {lockedBytes, setCode} from '../sheet.ts';
import type {Locked, Piece} from '../sheet.ts';
import {longDate, recover as words} from '../strings.ts';
import {sameBytes} from '../written.ts';
import {h} from './dom.ts';
import {createReader} from './reader.ts';
import type {Parts} from './reader.ts';

export interface Collector {
  element: HTMLElement;
  /** Turn the camera off, if it is on. Call when leaving the screen. */
  stop(): void;
}

interface Options {
  /** Called once there are enough sheets and the secret has come back. */
  onSecret(secret: string): void;
  /** Called when the person starts again; what was collected is forgotten. */
  onReset?(): void;
  /** The words on the button that starts again. */
  resetLabel: string;
  /** If given, only sheets of this set are accepted. */
  expected?: Locked;
}

export function createCollector(options: Options): Collector {
  let locked: Locked | null = null;
  const pieces = new Map<number, Piece>();

  const setLine = h('p', {class: 'set-line'});
  const list = h('ul', {class: 'collected'});
  const progress = h('p', {class: 'progress', role: 'status', 'aria-live': 'polite'}, words.none);
  const resetButton = h('button', {type: 'button', class: 'quiet', hidden: true, onclick: reset}, options.resetLabel);

  async function redraw(): Promise<void> {
    list.replaceChildren(
      ...[...pieces.keys()].sort((a, b) => a - b).map(number => h('li', {}, words.sheet(number, locked!.total))),
    );
    progress.textContent = locked ? words.progress(pieces.size, locked.needed) : words.none;
    setLine.textContent = locked
      ? words.setLine(locked.label, longDate(locked.madeOn), await setCode(locked))
      : '';
    resetButton.hidden = locked === null;
    reader.partAKnown(locked !== null);
  }

  function reset(): void {
    locked = null;
    pieces.clear();
    reader.setFinished(false);
    void redraw();
    options.onReset?.();
  }

  async function add({locked: partA, piece}: Parts): Promise<string> {
    const differs = (other: Locked) => partA !== undefined && !sameBytes(lockedBytes(partA), lockedBytes(other));
    if (partA && options.expected && differs(options.expected)) {
      throw new SheetError('mixed-sets', {problem: 'not-this-set', codes: [await setCode(partA)]});
    }
    // Two sheets that disagree: there is no telling which of them is the
    // true one, only that they do not belong together.
    if (locked && differs(locked)) throw new SheetError('mixed-sets', {problem: 'not-the-first'});
    const set = locked ?? partA;
    if (!set) throw new SheetError('malformed', {problem: 'no-part-a'});

    if (piece) {
      const report = await checkSheet({locked: set, piece});
      if (!report.intact) {
        throw new SheetError('wrong-piece', {
          sheets: [piece.number],
          ...(piece.number > set.total && {total: set.total}),
        });
      }
    }
    locked = set;
    const again = piece !== undefined && pieces.has(piece.number);
    if (piece) pieces.set(piece.number, piece);
    await redraw();

    if (pieces.size >= locked.needed) {
      const sheets = [...pieces.values()].map(each => ({locked: locked!, piece: each}));
      const secret = await recoverSecret(sheets);
      reader.setFinished(true); // enough: no more sheets are wanted
      options.onSecret(secret);
    }
    if (!piece) return words.partAIn;
    return again ? words.again(piece.number) : words.added(piece.number);
  }

  const reader = createReader(add);
  return {
    element: h('div', {class: 'collector'}, reader.element, setLine, list, progress, resetButton),
    stop: () => reader.stop(),
  };
}
