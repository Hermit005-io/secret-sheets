// Whether there is work on the page that would be lost by leaving it: a secret
// typed but not yet made into sheets, or sheets made but not yet finished
// with. The page asks before it is closed or reloaded in that state (the
// browser shows its own wording), and app.ts asks before going back.

let unfinished = false;

export function setUnfinished(value: boolean): void {
  unfinished = value;
}

export function isUnfinished(): boolean {
  return unfinished;
}

window.addEventListener('beforeunload', event => {
  if (!unfinished) return;
  event.preventDefault();
  event.returnValue = ''; // older browsers ask only when this is set
});
