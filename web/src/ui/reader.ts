// The three ways of getting a sheet into the page: the camera, a photo, or
// typing its lines. Used wherever a sheet is read: recovering, checking, and
// proving that freshly printed sheets work.

import {readParts} from '../core.ts';
import {SheetError} from '../errors.ts';
import {decodePhoto, startCamera} from '../scan.ts';
import type {Camera} from '../scan.ts';
import type {Locked, Piece} from '../sheet.ts';
import {errorMessage, unexpected, reader as words} from '../strings.ts';
import {isQrText, trimmed} from '../written.ts';
import {freshId, h, messageArea, showMessage} from './dom.ts';

export interface Parts {
  locked?: Locked;
  piece?: Piece;
}

export interface Reader {
  element: HTMLElement;
  /** Turn the camera off, if it is on. Call when leaving the screen. */
  stop(): void;
  /** Once Part A is known, typing only Part B of further sheets is enough. */
  partAKnown(known: boolean): void;
  /** Put the reader away once no more sheets are wanted, or bring it back. */
  setFinished(finished: boolean): void;
}

interface Options {
  /** The words on the button under the typing box. */
  submit?: string;
  /** Called whenever something new is about to be read. */
  onAttempt?: () => void;
}

/**
 * `onParts` is given what was read. It returns a sentence to show (the sheet
 * was added, say), or throws a SheetError, whose sentence is shown instead.
 */
export function createReader(onParts: (parts: Parts) => Promise<string>, options: Options = {}): Reader {
  const message = messageArea();
  let camera: Camera | null = null;
  let cameraWanted = false;

  /** Say something about what was just tried, in place of whatever was said before. */
  function say(text: string, kind: 'problem' | 'good'): void {
    options.onAttempt?.();
    showMessage(message, text, kind);
  }

  async function take(text: string): Promise<boolean> {
    options.onAttempt?.();
    try {
      showMessage(message, await onParts(readParts(text)), 'good');
      return true;
    } catch (problem) {
      const known = problem instanceof SheetError;
      showMessage(message, known ? errorMessage(problem) : unexpected, 'problem');
      if (!known) throw problem;
      return false;
    }
  }

  // ---- camera ----
  const video = h('video', {playsinline: true, muted: true, 'aria-label': words.cameraHelp});
  const cameraPanel = h('div', {class: 'camera', hidden: true}, video, h('p', {class: 'hint'}, words.cameraHelp));
  const cameraButton = h('button', {type: 'button', onclick: toggleCamera}, words.camera);

  function stopCamera(): void {
    cameraWanted = false;
    camera?.stop();
    camera = null;
    cameraPanel.hidden = true;
    cameraButton.textContent = words.camera;
  }

  async function toggleCamera(): Promise<void> {
    if (camera || cameraWanted) return stopCamera();
    typePanel.hidden = true;
    const handled = new Set<string>(); // the camera sees the same code many times a second
    try {
      cameraWanted = true;
      cameraPanel.hidden = false;
      const started = await startCamera(video, text => {
        if (handled.has(text)) return;
        handled.add(text);
        if (isQrText(text)) void take(text);
        else say(words.notASheet, 'problem');
      });
      // Permission can take a while to give. If the person has moved on in
      // the meantime, the camera must not be left running out of sight.
      if (!cameraWanted) return started.stop();
      camera = started;
      cameraButton.textContent = words.stopCamera;
    } catch {
      const stillWanted = cameraWanted;
      stopCamera();
      if (stillWanted) say(words.cameraRefused, 'problem');
    }
  }

  // ---- photo ----
  // On a phone this opens the camera for one picture, which is handed to the
  // page and not saved; on a computer it asks for a picture file.
  const photoInput = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    class: 'visually-hidden',
    tabindex: -1,
    'aria-hidden': 'true',
    onchange: async () => {
      const file = photoInput.files?.[0];
      photoInput.value = '';
      if (!file) return;
      const text = await decodePhoto(file).catch(() => null);
      if (!text) say(words.photoUnreadable, 'problem');
      else if (!isQrText(text)) say(words.notASheet, 'problem');
      else await take(text);
    },
  });
  const photoButton = h('button', {type: 'button', onclick: () => photoInput.click()}, words.photo);

  // ---- typing ----
  const typeId = freshId('typed');
  const typeHelp = h('p', {class: 'hint', id: `${typeId}-help`}, words.typeHelpFull);
  const typed = h('textarea', {
    id: typeId,
    rows: 8,
    spellcheck: false,
    autocapitalize: 'characters',
    autocomplete: 'off',
    'aria-describedby': `${typeId}-help`,
  });
  const typePanel = h(
    'form',
    {
      class: 'typing',
      hidden: true,
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (trimmed(typed.value) === '') {
          say(words.nothingTyped, 'problem');
        } else if (await take(typed.value)) {
          typed.value = '';
        }
        // Ready for the next sheet, unless that was the last one wanted.
        if (!element.hidden) typed.focus();
      },
    },
    h('label', {for: typeId}, words.typeLabel),
    typeHelp,
    typed,
    h('button', {type: 'submit'}, options.submit ?? words.add),
  );
  const typeButton = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        stopCamera();
        typePanel.hidden = !typePanel.hidden;
        if (!typePanel.hidden) typed.focus();
      },
    },
    words.type,
  );

  const element = h(
    'div',
    {class: 'reader'},
    h('div', {class: 'ways'}, cameraButton, photoButton, typeButton, photoInput),
    cameraPanel,
    typePanel,
  );

  return {
    // The message stays in view when the reader itself is put away.
    element: h('div', {}, element, message),
    stop: stopCamera,
    partAKnown(known) {
      typeHelp.textContent = known ? words.typeHelpPartB : words.typeHelpFull;
      typed.rows = known ? 5 : 8;
    },
    setFinished(finished) {
      if (finished) stopCamera();
      element.hidden = finished;
      if (!finished) {
        typed.value = '';
        showMessage(message, '');
      }
    },
  };
}
