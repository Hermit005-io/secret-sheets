// Making a set: the form, then the three things to do with the result
// (print, prove, hand out).

import {Refusal, splitSecret} from '../core.ts';
import {MAX_SECRET_BYTES} from '../locking.ts';
import {MAX_LABEL_BYTES, MAX_SHEETS, MIN_SHEETS, setCode} from '../sheet.ts';
import type {Sheet} from '../sheet.ts';
import {ready, refusalMessage, rule, unexpected, split as words} from '../strings.ts';
import {startsLikeALine} from '../written.ts';
import {createCollector} from './collector.ts';
import {freshId, h, messageArea, showMessage} from './dom.ts';
import {setUnfinished} from './guard.ts';
import {fitToPage, sheetPage} from './sheetpage.ts';

interface Screen {
  element: HTMLElement;
  leave(): void;
}

const bytesIn = (text: string) => new TextEncoder().encode(text).length;
/** A name or label as it will be printed: on one line, without stray spaces. */
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Whether `text` could be read as a typed line of a sheet, were a line of
 * the page to start at any one of its words. Someone may one day copy a whole
 * sheet into the page, words and all, and "B12 Vitamins" must not be taken
 * for line 12 of Part B.
 */
function holdsALine(text: string): boolean {
  const words = [...text.split(' '), '.']; // on the page, more always follows a name
  return words.some((_, i) => startsLikeALine(words.slice(i).join(' ')));
}

export function splitScreen(home: (notice?: string) => void): Screen {
  let total = 5;
  let needed = 3;
  let wanted = needed; // what was asked for, kept while there are too few sheets for it
  const holders: string[] = []; // kept when the number of people goes down and up again
  let stopReading = () => {};
  const root = h('div', {class: 'split'});

  // ---- the secret ----
  const secretId = freshId('secret');
  const room = h('p', {class: 'hint', id: `${secretId}-room`, role: 'status'});
  const edges = h('p', {class: 'hint', id: `${secretId}-edges`, role: 'status'});
  const secret = h('textarea', {
    id: secretId,
    rows: 3,
    spellcheck: false,
    autocomplete: 'off',
    autocapitalize: 'off',
    'aria-describedby': `${secretId}-help ${secretId}-room ${secretId}-edges`,
    oninput: () => {
      const used = bytesIn(secret.value);
      room.textContent = words.secretRoom(used, MAX_SECRET_BYTES);
      room.classList.toggle('over', used > MAX_SECRET_BYTES);
      const blank = secret.value.trim() === '';
      edges.textContent = !blank && secret.value !== secret.value.trim() ? words.secretEdges : '';
      setUnfinished(secret.value !== '');
    },
  });

  // ---- what it is for, and who it is from ----
  const labelId = freshId('label');
  const labelProblem = h('p', {class: 'hint over', id: `${labelId}-problem`, role: 'status'});
  const label = h('input', {
    id: labelId,
    type: 'text',
    autocomplete: 'off',
    placeholder: words.labelExample,
    'aria-describedby': `${labelId}-help ${labelId}-problem`,
    oninput: () => {
      labelProblem.textContent = bytesIn(tidy(label.value)) > MAX_LABEL_BYTES ? words.labelTooLong : '';
    },
  });
  const ownerId = freshId('owner');
  const owner = h('input', {
    id: ownerId,
    type: 'text',
    maxlength: 40,
    autocomplete: 'off',
    'aria-describedby': `${ownerId}-help`,
  });

  // ---- the rule, drawn as sheets you can count ----
  const slips = h('div', {class: 'slips', 'aria-hidden': 'true'});
  const ruleLine = h('p', {class: 'rule'});
  const consequences = h('p', {class: 'hint'});
  const names = h('div', {class: 'names'});

  function stepper(name: string, change: (by: number) => void) {
    const value = h('output', {});
    const step = (by: number, text: string, sign: string) =>
      h('button', {type: 'button', class: 'step', 'aria-label': `${name}: ${text}`, onclick: () => change(by)}, sign);
    const fewer = step(-1, words.fewer, '−');
    const more = step(1, words.more, '+');
    const element = h('div', {class: 'stepper'}, h('span', {class: 'stepper-name'}, name), fewer, value, more);
    return {
      element,
      show(shown: number, lowest: number, highest: number) {
        value.textContent = String(shown);
        // A button about to be switched off hands the keyboard to its twin.
        if (shown <= lowest && document.activeElement === fewer) more.focus();
        if (shown >= highest && document.activeElement === more) fewer.focus();
        fewer.disabled = shown <= lowest;
        more.disabled = shown >= highest;
      },
    };
  }

  const people = stepper(words.totalLabel, by => {
    total = Math.min(Math.max(total + by, MIN_SHEETS), MAX_SHEETS);
    drawRule();
  });
  const enough = stepper(words.neededLabel, by => {
    wanted = needed + by;
    drawRule();
  });

  function drawRule(): void {
    needed = Math.min(Math.max(wanted, 2), total);
    people.show(total, MIN_SHEETS, MAX_SHEETS);
    enough.show(needed, 2, total);
    slips.replaceChildren(
      ...Array.from({length: total}, (_, i) => h('span', {class: i < needed ? 'slip needed' : 'slip'})),
    );
    ruleLine.textContent = rule(needed, total);
    consequences.textContent = `${words.slack(needed, total)} ${words.trust(needed, total)}`;

    names.replaceChildren(
      ...Array.from({length: total}, (_, i) => {
        const id = freshId('name');
        const input = h('input', {
          id,
          type: 'text',
          maxlength: 40,
          autocomplete: 'off',
          value: holders[i] ?? '',
          oninput: () => (holders[i] = input.value),
        });
        return h('div', {class: 'name'}, h('label', {for: id}, words.nameLabel(i + 1)), input);
      }),
    );
  }

  const message = messageArea();
  const makeButton = h('button', {type: 'submit', class: 'primary'}, words.make);

  const form = h(
    'form',
    {
      novalidate: true,
      // Enter in a one-line field moves nowhere; only the button makes the sheets.
      onkeydown: (event: Event) => {
        if ((event as KeyboardEvent).key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      },
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (secret.value.trim() === '') {
          showMessage(message, refusalMessage(new Refusal('no-secret')), 'problem');
          secret.focus();
          return;
        }
        const names = Array.from({length: total}, (_, i) => tidy(holders[i] ?? ''));
        const mistakable = [tidy(label.value), tidy(owner.value), ...names].find(holdsALine);
        if (mistakable !== undefined) {
          showMessage(message, words.looksLikeALine(mistakable), 'problem');
          return;
        }
        makeButton.disabled = true;
        showMessage(message, words.making);
        try {
          const original = secret.value; // as it is now, whatever is typed while the sheets are made
          const sheets = await splitSecret(original, needed, total, tidy(label.value));
          showMessage(message, '');
          await showReady(sheets, original);
        } catch (problem) {
          const refused = problem instanceof Refusal;
          showMessage(message, refused ? refusalMessage(problem) : unexpected, 'problem');
          if (!refused) throw problem;
        } finally {
          makeButton.disabled = false;
        }
      },
    },
    h('label', {for: secretId}, words.secretLabel),
    h('p', {class: 'hint', id: `${secretId}-help`}, words.secretHelp),
    secret,
    room,
    edges,
    h('label', {for: labelId}, words.labelLabel),
    h('p', {class: 'hint', id: `${labelId}-help`}, words.labelHelp),
    label,
    labelProblem,
    h('label', {for: ownerId}, words.ownerLabel),
    h('p', {class: 'hint', id: `${ownerId}-help`}, words.ownerHelp),
    owner,
    h('div', {class: 'rule-picker'}, people.element, enough.element, slips, ruleLine, consequences),
    h('fieldset', {}, h('legend', {}, words.namesLegend), names),
    message,
    makeButton,
  );

  function showForm(): void {
    stopReading();
    setUnfinished(secret.value !== '');
    root.replaceChildren(
      h('button', {type: 'button', class: 'back', onclick: () => home()}, words.back),
      h('h1', {tabindex: -1}, words.title),
      form,
    );
    window.scrollTo(0, 0);
    root.querySelector('h1')!.focus();
  }

  // ---- after the sheets are made ----
  async function showReady(sheets: Sheet[], original: string): Promise<void> {
    const made = sheets[0]!.locked;
    const code = await setCode(made);
    const proof = messageArea();
    let proved = false;

    const collector = createCollector({
      expected: made,
      resetLabel: ready.again,
      onSecret(recovered) {
        proved = recovered === original;
        showMessage(proof, proved ? ready.proved : ready.notProved, proved ? 'good' : 'problem');
        if (proved) {
          // Any warning about not having checked no longer applies.
          showMessage(warning, '');
          finishButton.textContent = ready.finish;
        }
      },
      onReset() {
        proved = false;
        showMessage(proof, '');
      },
    });
    stopReading = () => collector.stop();

    // Finishing without having checked the printed sheets takes a second press.
    const warning = messageArea();
    const finishButton = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          if (proved || finishButton.textContent === ready.finishAnyway) {
            setUnfinished(false);
            return home(ready.finished);
          }
          showMessage(warning, ready.notChecked, 'problem');
          finishButton.textContent = ready.finishAnyway;
        },
      },
      ready.finish,
    );

    const pages = h(
      'div',
      {class: 'pages'},
      h('h2', {class: 'pages-title'}, ready.sheets),
      ...sheets.map((sheet, i) => sheetPage(sheet, code, tidy(holders[i] ?? ''), tidy(owner.value))),
    );

    root.replaceChildren(
      h('button', {type: 'button', class: 'back', onclick: showForm}, ready.change),
      h('h1', {tabindex: -1}, ready.title),
      h('p', {class: 'lead'}, `${rule(made.needed, made.total)} ${ready.setCode} `, h('strong', {}, code), '.'),
      h(
        'ol',
        {class: 'steps'},
        h(
          'li',
          {},
          h('h2', {}, ready.printStep),
          h('p', {}, ready.printHelp),
          h('button', {type: 'button', class: 'primary', onclick: () => window.print()}, ready.print),
        ),
        h(
          'li',
          {},
          h('h2', {}, ready.proveStep),
          h('p', {}, ready.proveHelp(made.needed, made.total)),
          collector.element,
          proof,
        ),
        h('li', {}, h('h2', {}, ready.handOutStep), h('p', {}, ready.handOutHelp), warning, finishButton),
      ),
      pages,
    );
    fitToPage(pages);
    setUnfinished(true);
    window.scrollTo(0, 0);
    root.querySelector('h1')!.focus();
  }

  drawRule();
  showForm();
  return {
    element: root,
    leave() {
      stopReading();
      secret.value = '';
      setUnfinished(false);
    },
  };
}
