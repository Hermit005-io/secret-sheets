// A small helper for building the page without a framework.
//
//     h('button', {class: 'primary', onclick: save}, 'Save')

type Child = Node | string | null | undefined | false;
type Attributes = Record<string, string | number | boolean | EventListener | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') {
      element.addEventListener(name.replace(/^on/, ''), value);
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, String(value));
    }
  }
  element.append(...children.flat().filter((child): child is Node | string => Boolean(child)));
  return element;
}

let nextId = 0;

/** An id nothing else on the page is using, for tying labels to fields. */
export function freshId(prefix: string): string {
  return `${prefix}-${++nextId}`;
}

/** A place for messages that a screen reader announces when they change. */
export function messageArea(): HTMLElement {
  return h('p', {class: 'message', role: 'status', 'aria-live': 'polite'});
}

export function showMessage(area: HTMLElement, text: string, kind: 'problem' | 'good' | '' = ''): void {
  area.textContent = text;
  area.className = `message ${kind}`.trim();
}
