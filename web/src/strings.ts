// Every sentence the page shows, in one place, so that a translation means
// changing this file and nothing else.
//
// The page never says "share", "threshold" or "Shamir". It says sheets,
// people, and how many are needed.

import type {Refusal} from './core.ts';
import type {SheetError} from './errors.ts';
import type {CalendarDate} from './sheet.ts';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Where the page lives, printed on every sheet so that a holder can find it
// years later.
export const PAGE_ADDRESS = 'https://hermit005-io.github.io/secret-sheets/';

export const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function longDate({year, month, day}: CalendarDate): string {
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export const home = {
  title: 'Secret Sheets',
  lead: 'Split a password or code into printed sheets for people you trust. You choose how many of them must come together to bring it back, for example any 3 of 5. Fewer cannot.',
  split: {name: 'Split a secret', about: 'Turn a secret into sheets to print and hand out.'},
  recover: {name: 'Recover a secret', about: 'Bring enough sheets together and read the secret.'},
  check: {name: 'Check a sheet', about: 'See that a sheet is still good. It does not show the secret.'},
  private: 'Nothing you type here leaves this device. The page works with the internet switched off, and you can save it and open the copy.',
  noEncryption: 'This browser will not encrypt on this page. Open the page from a saved file, or from an address that starts with https.',
};

export const leaving =
  'Not finished: nothing has been cleared yet. To leave anyway and lose what is here, go back once more.';

export const unexpected = 'Something went wrong that should not have, and nothing was done. Reload the page and try again.';

/** The rule of a set in plain words. */
export function rule(needed: number, total: number): string {
  if (needed < total) return `Any ${needed} of the ${total} sheets recover the secret.`;
  if (total === 2) return 'Both sheets are needed to recover the secret.';
  return `All ${total} sheets are needed to recover the secret.`;
}

export const split = {
  title: 'Split a secret',
  back: 'Back to the start',
  secretLabel: 'The secret',
  secretHelp: 'A password, recovery codes, a PIN. It comes back exactly as you type it here, so check it carefully.',
  // Shown only when it matters: nearly full, or over.
  secretRoom(used: number, limit: number): string {
    if (used > limit) {
      return `Too long to fit on a sheet: it takes ${used} bytes, and the limit is ${limit}. A plain letter or digit is one byte; accented letters and symbols are more.`;
    }
    return used > 0.75 * limit ? `Nearly full: ${used} of ${limit} bytes.` : '';
  },
  secretEdges: 'The secret starts or ends with a space or a line break. It will come back exactly like that.',
  labelLabel: 'What it is for (optional)',
  labelHelp: 'Printed on every sheet for anyone to read. Say what the secret opens, never the secret itself.',
  labelExample: 'Email recovery codes',
  labelTooLong: 'This is too long to print on every sheet. Shorten it.',
  ownerLabel: 'Your name (optional)',
  ownerHelp: 'Printed on every sheet, so that whoever holds it knows who it came from.',
  totalLabel: 'How many people get a sheet',
  neededLabel: 'How many sheets are needed',
  fewer: 'One fewer',
  more: 'One more',
  namesLegend: 'Who gets each sheet (optional)',
  nameLabel: (number: number) => `Sheet ${number}`,
  looksLikeALine: (text: string) =>
    `Part of “${text}” looks like a line of a sheet (such as “A01”), and would be mistaken for one. Please change it.`,
  make: 'Make the sheets',
  making: 'Making the sheets…',

  slack(needed: number, total: number): string {
    const spare = total - needed;
    if (spare === 0) {
      return 'If even one is lost, the secret is gone for good.';
    }
    return (
      `If ${spare} ${plural(spare, 'is', 'are')} lost, you can still recover it. ` +
      `If ${spare + 1} are lost, you cannot.`
    );
  },
  trust(needed: number, total: number): string {
    if (needed === total) {
      return `${total === 2 ? 'Both' : `All ${total}`} of these people would have to agree to read the secret without you.`;
    }
    return needed === 2
      ? 'Any 2 of these people could read the secret together, without you.'
      : `It would take ${needed} of these people agreeing to read the secret without you.`;
  },
};

export const ready = {
  title: 'Your sheets are ready',
  change: 'Go back and change something',
  setCode: 'Every sheet of this set shows the set code',
  printStep: 'Print them',
  printHelp: 'One sheet per page. If you save them as a PDF instead, delete the file once they are printed.',
  print: 'Print the sheets',
  proveStep: 'Prove they work',
  proveHelp(needed: number, total: number): string {
    const which = total === 2 ? 'both' : needed === total ? `all ${total}` : `any ${needed}`;
    return `Before you rely on them, take ${which} of the sheets you just printed and scan or type them in here, from the paper. This catches a faint printer or a missing page now, not in an emergency.`;
  },
  proved: 'These sheets work. The secret came back exactly as you typed it.',
  notProved: 'The sheets were read, but the secret did not come back as you typed it. Do not use these sheets.',
  again: 'Start this check again',
  handOutStep: 'Hand them out',
  handOutHelp: 'Give each person their sheet. Tell them what it is, who else has one, and when they should use it. Then finish here, which clears the secret from this page.',
  finish: 'Finish and clear',
  notChecked: 'You have not checked the printed sheets. If they turn out not to be readable, the secret cannot be recovered from them.',
  finishAnyway: 'Finish without checking',
  finished: 'Cleared. You can close this tab now.',
  sheets: 'The sheets, as they will print',
};

export const reader = {
  camera: 'Use the camera',
  photo: 'Use a photo',
  type: 'Type it in',
  stopCamera: 'Stop the camera',
  cameraHelp: 'Hold the sheet so its square code fills most of the frame.',
  cameraRefused: 'The camera could not be used. Use a photo of the sheet, or type it in.',
  photoUnreadable: 'No sheet code was found in that photo. Try again closer and in better light, or type the sheet in.',
  typeLabel: 'The lines from the sheet',
  typeHelpFull: 'Type every line of Part A and Part B, each on its own line. Capitals, spaces and dashes do not matter.',
  typeHelpPartB: 'Part A is already in. Type only Part B of the next sheet (4 lines).',
  nothingTyped: 'Type the lines from the sheet first.',
  add: 'Add this sheet',
  check: 'Check this sheet',
  notASheet: 'That is a code, but not one from a secret sheet.',
};

export const recover = {
  title: 'Recover a secret',
  lead: 'Add sheets one at a time. The secret appears when there are enough.',
  none: 'No sheets yet.',
  progress: (have: number, needed: number) => `${have} of the ${needed} needed`,
  sheet: (number: number, total: number) => `Sheet ${number} of ${total}`,
  added: (number: number) => `Sheet ${number} added.`,
  again: (number: number) => `Sheet ${number} is already in.`,
  partAIn: 'Part A is in. Now type Part B of the same sheet.',
  setLine: (label: string, date: string, code: string) =>
    `${label ? `“${label}”, made` : 'Made'} on ${date}. Set code ${code}.`,
  secretTitle: 'The secret',
  copy: 'Copy',
  copied: 'Copied',
  onClipboard: 'The secret is now on the clipboard. Copy something else afterwards to replace it.',
  hide: 'Hide',
  show: 'Show',
  clear: 'Clear and start again',
  afterwards: 'When you have what you need, clear this page and close the tab.',
};

export const check = {
  title: 'Check a sheet',
  lead: 'Scan or type one sheet to see that it is still good. This does not show the secret.',
  intact: 'This sheet is intact.',
  damaged: 'This sheet will not work.',
  damagedWhy: (number: number) =>
    `Its Part B is not the one that belongs to sheet ${number} of this set. If you typed it in, check that both parts came from the same sheet.`,
  whichSheet: (number: number, total: number, label: string) =>
    `Sheet ${number} of ${total}${label ? ` for “${label}”` : ''}.`,
  made: (date: string, code: string) => `Made on ${date}. Set code ${code}.`,
};

// The words on a printed sheet. The Python version prints the same sentences
// (secretsheets/page.py), apart from the ones about scanning: a text file has
// no code to scan. Keep the two in step, PAGE_ADDRESS included.
export const sheet = {
  title: (number: number, total: number) => `Secret sheet ${number} of ${total}`,
  holder: (name: string) => `for ${name}`,
  label: 'Purpose',
  owner: 'From',
  madeOn: 'Made on',
  setCode: 'Set code',
  whatTitle: 'What this is',
  what(needed: number, total: number, owner: string): string {
    const start = `${owner || 'Someone'} has trusted you with one of ${total} sheets.`;
    if (total === 2) return `${start} The two together unlock a secret. Either one alone unlocks nothing.`;
    const howMany = needed === total ? `all ${total}` : `any ${needed}`;
    const alone =
      needed === 2
        ? 'This sheet alone unlocks nothing.'
        : `This sheet alone unlocks nothing, and neither do any ${needed - 1} of them.`;
    return `${start} Together, ${howMany} of them unlock a secret. ${alone}`;
  },
  doTitle: 'What to do',
  doLines: (owner: string) => [
    'Keep this sheet somewhere safe and dry, where you will find it again.',
    'Do not keep a photo or a copy of it on a phone, on a computer or online.',
    `If you lose it, tell ${owner || 'the person who gave it to you'}.`,
  ],
  recoverTitle: 'To recover the secret',
  recoverLine(needed: number, total: number): string {
    const bring =
      total === 2
        ? 'Bring both sheets together'
        : needed === total
          ? `Bring all ${total} sheets together`
          : `Bring ${needed} of the sheets together`;
    return `${bring} and check that they show the same set code. Then open the Secret Sheets page, choose “Recover a secret”, and scan or type them in.`;
  },
  // On a line of its own and with nothing after it, so that no full stop or
  // comma is typed as part of the address.
  address: PAGE_ADDRESS && `The page is at ${PAGE_ADDRESS}`,
  typing: 'To type a sheet in, copy every line of Part A and Part B, including the two characters at the end of each line.',
  partA: 'Part A (the same on every sheet of this set)',
  partB: (number: number, total: number) => `Part B (sheet ${number} of ${total} only)`,
  qrCaption: 'Scan this code with the Secret Sheets page, or type the lines below.',
};

export function refusalMessage(refusal: Refusal): string {
  switch (refusal.reason) {
    case 'no-secret':
      return 'Type the secret first.';
    case 'secret-too-long':
      return split.secretRoom(refusal.bytes, refusal.limit);
    case 'unusable-characters':
      return 'The secret or the label contains something that is not a character and cannot be stored.';
    case 'label-too-long':
      return '“What it is for” is too long to print on every sheet. Shorten it.';
    case 'label-not-plain':
      return '“What it is for” must be plain text on one line.';
    case 'total':
      return 'The number of sheets must be from 2 to 20.';
    case 'needed':
      return 'The number needed must be at least 2 and no more than the number of sheets.';
  }
}

const LINE_PROBLEMS: Record<string, (line: string) => string> = {
  incomplete: line => `Line ${line} is incomplete.`,
  mistake: line => `Line ${line} has a mistake in it. Check it against the sheet.`,
  twice: line => `Line ${line} appears twice, with different contents.`,
  missing: line => `Line ${line} is missing.`,
  short: line => `Line ${line} is shorter than it should be.`,
};

const MALFORMED: Record<string, string> = {
  'not-a-sheet': 'That is not the code from a secret sheet.',
  'damaged-code': 'The sheet’s code is damaged and cannot be read.',
  'nothing-found': 'No lines from a sheet were found. Each line starts with A01, B01 and so on.',
  'no-part-a': 'Part A of this sheet was not found.',
  'no-part-b': 'Part B of this sheet was not found.',
  coordinates: 'Two of these sheets hold the same piece under different numbers. A set made properly never does.',
};

export function errorMessage(error: SheetError): string {
  const {line, problem, sheets, codes, needed, have, total, version} = error.detail;
  switch (error.failure) {
    case 'bad-line':
      return (LINE_PROBLEMS[problem ?? ''] ?? LINE_PROBLEMS.mistake!)(line ?? '');
    case 'malformed':
      return MALFORMED[problem ?? ''] ?? 'This is not a complete secret sheet. Part of it is missing or wrong.';
    case 'unsupported-version':
      return `This sheet uses format version ${version}. This page reads version 1. A newer copy of the page may be needed.`;
    case 'mixed-sets':
      if (problem === 'not-this-set') {
        return `This sheet is from a different set (set code ${codes?.[0]}). Use the sheets you just printed.`;
      }
      if (problem === 'not-the-first') {
        return 'This sheet does not match the first one added. One of the two is from a different set, or has been altered.';
      }
      if (sheets?.length === 1) {
        return `Sheet ${sheets[0]} does not belong with the others. It is from a different set, or it has been altered.`;
      }
      if (sheets?.length) {
        return `Sheets ${sheets.join(', ')} do not belong with the others. They are from a different set, or altered.`;
      }
      if (codes?.length) {
        return `These sheets are not all from the same set, or one has been altered (set codes ${codes.join(' and ')}).`;
      }
      return 'These sheets are not all from the same set, or one has been altered.';
    case 'wrong-piece':
      if (total) {
        return `Sheet ${sheets?.[0]} cannot belong to this set, which has only ${total} sheets.`;
      }
      return `Sheet ${sheets?.[0]}’s piece is damaged, or it comes from a different set.`;
    case 'too-few':
      if (!needed) return 'At least one complete sheet is needed: Part A as well as Part B.';
      return `${needed} different sheets are needed, and so far there ${plural(have ?? 0, 'is', 'are')} ${have}.`;
    case 'cannot-unlock':
      return 'These sheets agree with each other but do not unlock the secret. They may all have been altered.';
  }
}
