import {home as words} from '../strings.ts';
import {h} from './dom.ts';

export type Destination = 'split' | 'recover' | 'check';

export function homeScreen(go: (to: Destination) => void, notice = ''): HTMLElement {
  const choice = (to: Destination) =>
    h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          class: 'choice',
          'data-go': to,
          // The second click of a double-click meant for the screen before
          // this one lands here; it is not a choice.
          onclick: (event: Event) => (event as MouseEvent).detail < 2 && go(to),
        },
        h('strong', {}, words[to].name),
        h('span', {}, words[to].about),
      ),
    );

  return h(
    'div',
    {class: 'home'},
    h('h1', {tabindex: -1}, words.title),
    notice && h('p', {class: 'message good', role: 'status'}, notice),
    // Browsers only encrypt on pages they consider safely delivered.
    !globalThis.crypto?.subtle && h('p', {class: 'message problem', role: 'alert'}, words.noEncryption),
    h('p', {class: 'lead'}, words.lead),
    h('ul', {class: 'choices'}, choice('split'), choice('recover'), choice('check')),
    h('p', {class: 'private'}, words.private),
  );
}
