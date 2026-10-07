// The page: one screen at a time, swapped in place. Nothing is stored or sent,
// and the address never changes, so closing the tab leaves no trace.

import {leaving as leavingWords} from './strings.ts';
import {checkScreen} from './ui/check.ts';
import {h} from './ui/dom.ts';
import {isUnfinished} from './ui/guard.ts';
import {homeScreen} from './ui/home.ts';
import type {Destination} from './ui/home.ts';
import {recoverScreen} from './ui/recover.ts';
import {splitScreen} from './ui/split.ts';

const screens = {split: splitScreen, recover: recoverScreen, check: checkScreen};
const main = document.querySelector('main')!;
let leaveCurrent = () => {};
let current: Destination | null = null; // null on the first screen
let noticeForHome = '';
let goingHome = false; // asked to go back, and the browser has not yet done it
let warning: HTMLElement | null = null; // shown after a first try at leaving unfinished work

function show(element: HTMLElement, leave: () => void = () => {}): void {
  leaveCurrent();
  leaveCurrent = leave;
  warning = null;
  main.replaceChildren(element);
  window.scrollTo(0, 0);
  // Move keyboard and screen-reader focus to the new screen's heading.
  element.querySelector<HTMLElement>('h1')?.focus();
}

function open(to: Destination): void {
  const screen = screens[to](home);
  current = to;
  show(screen.element, screen.leave);
}

/** Back to the first screen, the same way the browser's Back button goes. */
function home(notice = ''): void {
  if (goingHome) return;
  goingHome = true;
  noticeForHome = notice;
  history.back();
}

// Each screen is one step in the browser's history, so that Back returns to
// the first screen instead of leaving the page. A screen reached again with
// Back or Forward starts empty: nothing typed is kept anywhere.
window.addEventListener('popstate', event => {
  goingHome = false;
  if (current && isUnfinished() && !warning) {
    // A slip of the finger should not throw work away. Stay where we were,
    // by putting the step back, and say how to leave.
    history.pushState({screen: current}, '');
    warning = h('p', {class: 'message problem', role: 'alert'}, leavingWords);
    main.prepend(warning);
    window.scrollTo(0, 0);
    return;
  }
  const to = (event.state as {screen?: Destination} | null)?.screen;
  if (to && to in screens) {
    open(to);
  } else {
    current = null;
    show(homeScreen(go, noticeForHome));
  }
  noticeForHome = '';
});

// The warning stands until the person carries on with something else.
function carryOn(event: Event): void {
  if (!warning || (event.target as Element).closest('.back')) return;
  warning.remove();
  warning = null;
}
main.addEventListener('click', carryOn);
main.addEventListener('input', carryOn);

function go(to: Destination): void {
  history.pushState({screen: to}, '');
  open(to);
}

// A reloaded page keeps its old place in the history; start it clean.
history.replaceState(null, '');
show(homeScreen(go));
