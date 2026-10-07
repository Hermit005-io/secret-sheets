import {recover as words, split} from '../strings.ts';
import {createCollector} from './collector.ts';
import {h} from './dom.ts';

const COPIED_FOR_MS = 2500;

export function recoverScreen(home: () => void) {
  let secret = '';
  let concealed = false;

  // The secret is selectable and can be reached with the keyboard.
  const shown = h('pre', {class: 'secret', tabindex: 0});
  const clipboardNote = h('p', {class: 'hint', role: 'status'});

  function draw(): void {
    shown.textContent = concealed ? '•'.repeat(12) : secret;
    hideButton.textContent = concealed ? words.show : words.hide;
  }

  const copyButton = h(
    'button',
    {
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(secret);
          copyButton.textContent = words.copied;
          clipboardNote.textContent = words.onClipboard;
          setTimeout(() => (copyButton.textContent = words.copy), COPIED_FOR_MS);
        } catch {
          // No clipboard access (an old browser, or a page opened from a
          // file): select the text so the person can copy it themselves.
          concealed = false;
          draw();
          getSelection()?.selectAllChildren(shown);
        }
      },
    },
    words.copy,
  );
  const hideButton = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        concealed = !concealed;
        draw();
      },
    },
    words.hide,
  );
  const result = h(
    'section',
    {class: 'result', hidden: true},
    h('h2', {}, words.secretTitle),
    shown,
    h('div', {class: 'ways'}, copyButton, hideButton),
    clipboardNote,
    h('p', {class: 'hint'}, words.afterwards),
  );

  function forget(): void {
    secret = '';
    concealed = false;
    clipboardNote.textContent = '';
    draw();
    result.hidden = true;
  }

  const collector = createCollector({
    resetLabel: words.clear,
    onReset: forget,
    onSecret(recovered) {
      secret = recovered;
      draw();
      result.hidden = false;
      // On a phone the secret would otherwise appear below the screen's edge.
      result.scrollIntoView({block: 'start'});
      shown.focus({preventScroll: true});
    },
  });

  return {
    element: h(
      'div',
      {class: 'recover'},
      h('button', {type: 'button', class: 'back', onclick: () => home()}, split.back),
      h('h1', {tabindex: -1}, words.title),
      h('p', {class: 'lead'}, words.lead),
      collector.element,
      result,
    ),
    leave() {
      collector.stop();
      forget();
    },
  };
}
