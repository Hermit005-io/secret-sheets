// One printed sheet: what a holder reads, possibly years later and with
// nobody to ask. It has to stand on its own.

import {lockedBytes, pieceBytes, sheetBytes} from '../sheet.ts';
import type {Sheet} from '../sheet.ts';
import {longDate, sheet as words} from '../strings.ts';
import {qrSvg} from '../qr.ts';
import {qrText, typedLines} from '../written.ts';
import {h} from './dom.ts';

// The sizes of type a sheet can be printed in, largest first (style.css).
const SIZES = ['size-1', 'size-2', 'size-3', 'size-4', 'size-5'] as const;

/** `holder` is who the sheet is for and `owner` who it is from; both may be empty. */
export function sheetPage(sheet: Sheet, setCode: string, holder: string, owner: string): HTMLElement {
  const {locked, piece} = sheet;
  const title = words.title(piece.number, locked.total);

  const facts = h('dl', {class: 'facts'});
  const fact = (name: string, value: string) => value && facts.append(h('dt', {}, name), h('dd', {}, value));
  fact(words.label, locked.label);
  fact(words.owner, owner);
  fact(words.madeOn, longDate(locked.madeOn));
  fact(words.setCode, setCode);

  const code = h('figure', {class: 'code'});
  code.append(qrSvg(qrText(sheetBytes(sheet)), title), h('figcaption', {}, words.qrCaption));

  const part = (letter: 'a' | 'b', heading: string, lines: string[]) =>
    h('div', {class: 'part'}, h('h3', {}, heading), h('pre', {class: `lines part-${letter}`}, lines.join('\n')));

  return h(
    'section',
    {class: `sheet ${SIZES[0]}`},
    h('header', {}, h('h2', {}, title), holder && h('p', {class: 'holder'}, words.holder(holder))),
    h(
      'div',
      {class: 'about'},
      h(
        'div',
        {},
        facts,
        h('h3', {}, words.whatTitle),
        h('p', {}, words.what(locked.needed, locked.total, owner)),
        h('h3', {}, words.doTitle),
        h('ul', {}, ...words.doLines(owner).map(line => h('li', {}, line))),
        h('h3', {}, words.recoverTitle),
        h('p', {}, words.recoverLine(locked.needed, locked.total)),
        words.address && h('p', {class: 'address'}, words.address),
        h('p', {}, words.typing),
      ),
      code,
    ),
    part('a', words.partA, typedLines('A', lockedBytes(locked))),
    part('b', words.partB(piece.number, locked.total), typedLines('B', pieceBytes(piece))),
  );
}

// How tall a sheet may be and still print on one page: the height US Letter,
// the shorter of the two common papers, leaves inside the page's margins
// (253 mm), less a little for the differences between screens and printers.
const PAGE_HEIGHT_MM = 240;

/**
 * Give the sheets in `pages` the largest type at which every one of them
 * fits on a single page, or the smallest there is if none does.
 *
 * It is found by trying: the sheets are laid out at the width of a printed
 * page and measured, on this device and with its own fonts, because how
 * much room words take differs from one device to the next. All the sheets
 * of a set get the same size. `pages` must be on the page already.
 */
export function fitToPage(pages: HTMLElement): void {
  const sheets = [...pages.querySelectorAll<HTMLElement>('.sheet')];
  const ruler = h('div', {class: 'ruler'}); // 100 mm tall
  pages.append(ruler);
  pages.classList.add('measuring');
  const limit = (ruler.getBoundingClientRect().height / 100) * PAGE_HEIGHT_MM;

  for (const size of SIZES) {
    for (const sheet of sheets) {
      sheet.classList.remove(...SIZES);
      sheet.classList.add(size);
    }
    if (sheets.every(sheet => sheet.getBoundingClientRect().height <= limit)) break;
  }

  pages.classList.remove('measuring');
  ruler.remove();
}
