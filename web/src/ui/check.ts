import {checkSheet} from '../core.ts';
import {SheetError} from '../errors.ts';
import {check as words, longDate, reader as readerWords, rule, split} from '../strings.ts';
import {h} from './dom.ts';
import {createReader} from './reader.ts';

export function checkScreen(home: () => void) {
  const report = h('section', {class: 'report', hidden: true, 'aria-live': 'polite'});

  const reader = createReader(
    async ({locked, piece}) => {
      if (!locked) throw new SheetError('malformed', {problem: 'no-part-a'});
      if (!piece) throw new SheetError('malformed', {problem: 'no-part-b'});
      const found = await checkSheet({locked, piece});
      report.replaceChildren(
        h('h2', {class: found.intact ? 'good' : 'problem'}, found.intact ? words.intact : words.damaged),
        ...(found.intact ? [] : [h('p', {}, words.damagedWhy(found.number))]),
        h('p', {}, words.whichSheet(found.number, found.total, found.label)),
        h('p', {}, rule(found.needed, found.total)),
        h('p', {}, words.made(longDate(found.madeOn), found.setCode)),
      );
      report.hidden = false;
      report.scrollIntoView({block: 'nearest'});
      return '';
    },
    {
      submit: readerWords.check,
      // What was said about the last sheet does not apply to the next one.
      onAttempt: () => (report.hidden = true),
    },
  );

  return {
    element: h(
      'div',
      {class: 'check'},
      h('button', {type: 'button', class: 'back', onclick: () => home()}, split.back),
      h('h1', {tabindex: -1}, words.title),
      h('p', {class: 'lead'}, words.lead),
      reader.element,
      report,
    ),
    leave: () => reader.stop(),
  };
}
