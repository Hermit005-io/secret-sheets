import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';

import {PAGE, SECRET, finishUnchecked, makeSheets, open, typeIn, vectors} from './helpers.ts';

test('a secret is split, proved on the spot, and recovered in a fresh page', async ({page, context}) => {
  await open(page);
  const made = await makeSheets(page, {label: 'Email recovery codes'});

  // Prove they work: Part A once, then only Part B of two more sheets.
  await typeIn(page, `${made.partA}\n${made.partB[4]}`);
  await expect(page.getByText('Sheet 5 added.')).toBeVisible();
  await expect(page.getByText('1 of the 3 needed')).toBeVisible();
  await typeIn(page, made.partB[1]!);
  await typeIn(page, made.partB[2]!);
  await expect(page.getByText('These sheets work.')).toBeVisible();
  // Enough is enough: there is nowhere left to add a fourth.
  await expect(page.getByText('3 of the 3 needed')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Type it in'})).toBeHidden();

  await page.getByRole('button', {name: 'Finish and clear'}).click();
  await expect(page.getByText('Cleared.')).toBeVisible();
  await page.getByRole('button', {name: 'Split a secret'}).click();
  await expect(page.getByLabel('The secret')).toHaveValue('');

  // Someone else, somewhere else, later.
  const later = await context.newPage();
  await open(later);
  await later.getByRole('button', {name: 'Recover a secret'}).click();
  await typeIn(later, `${made.partA}\n${made.partB[0]}`);
  await expect(later.getByText('“Email recovery codes”, made on')).toBeVisible();
  await typeIn(later, made.partB[3]!);
  await expect(later.locator('.secret')).toBeHidden();
  await typeIn(later, made.partB[2]!);
  await expect(later.locator('.secret')).toHaveText(SECRET);
  await expect(later.locator('.secret')).toBeFocused();
  await expect(later.getByRole('button', {name: 'Type it in'})).toBeHidden();

  await later.getByRole('button', {name: 'Hide'}).click();
  await expect(later.locator('.secret')).not.toContainText(SECRET);
  await later.getByRole('button', {name: 'Show'}).click();
  await expect(later.locator('.secret')).toHaveText(SECRET);

  await later.getByRole('button', {name: 'Clear and start again'}).click();
  await expect(later.getByText('No sheets yet.')).toBeVisible();
  await expect(later.locator('.secret')).toBeHidden();
  await expect(later.locator('body')).not.toContainText(SECRET);
  await expect(later.getByRole('button', {name: 'Type it in'})).toBeVisible();
});

test('the secret comes back exactly, whatever is in it', async ({page}) => {
  const secret = '  pässwörd ключ 密碼 🔑\n  second line\t';
  await open(page);
  await page.getByRole('button', {name: 'Split a secret'}).click();
  await page.getByLabel('The secret').fill(secret);
  await expect(page.getByText('The secret starts or ends with a space or a line break.')).toBeVisible();
  await page.getByLabel('The secret').fill('');
  await page.getByRole('button', {name: 'Back to the start'}).click();

  const made = await makeSheets(page, {secret, needed: 2, total: 2});
  await finishUnchecked(page);
  await page.getByRole('button', {name: 'Recover a secret'}).click();
  await typeIn(page, `${made.partA}\n${made.partB[0]}`);
  await typeIn(page, made.partB[1]!);
  expect(await page.locator('.secret').evaluate(element => element.textContent)).toBe(secret);
});

test('sheets made by the Python version are read here, however they are typed', async ({page}) => {
  const {part_b, secret, as_people_type} = vectors.typed;
  await open(page);
  await page.getByRole('button', {name: 'Recover a secret'}).click();
  const untidy = as_people_type.find((entry: {name: string}) => entry.name === 'no spaces or dashes at all');
  await typeIn(page, untidy.text);
  await expect(page.getByText('Sheet 1 added.')).toBeVisible();
  await typeIn(page, part_b[3].join('\n').toLowerCase());
  await typeIn(page, part_b[4].join('\n'));
  await expect(page.locator('.secret')).toHaveText(secret);
});

test('mistakes are explained, and name the line or the sheet', async ({page}) => {
  await open(page);
  const made = await makeSheets(page);
  const other = vectors.typed;
  const box = page.getByLabel('The lines from the sheet');

  await page.getByRole('button', {name: 'Type it in'}).click();
  await page.getByRole('button', {name: 'Add this sheet'}).click();
  await expect(page.getByText('Type the lines from the sheet first.')).toBeVisible();

  // Something that is not a sheet is said to be so, and is not thrown away.
  await typeIn(page, 'my sheet is in the drawer');
  await expect(page.getByText('No lines from a sheet were found.')).toBeVisible();
  await expect(box).toHaveValue('my sheet is in the drawer');

  const lines = made.partB[0]!.split('\n');
  const mistyped = lines[1]!.replace(/[0-9A-Z](?=-)/, char => (char === '7' ? '8' : '7'));
  await typeIn(page, [made.partA, lines[0], mistyped, lines[2], lines[3]].join('\n'));
  await expect(page.getByText('Line B02 has a mistake in it.')).toBeVisible();
  await expect(box).toHaveValue(new RegExp(mistyped));

  await typeIn(page, made.partB[1]!);
  await expect(page.getByText('Part A of this sheet was not found.')).toBeVisible();

  await typeIn(page, made.partA);
  await expect(page.getByText('Part A is in. Now type Part B of the same sheet.')).toBeVisible();
  await typeIn(page, made.partB[1]!);
  await expect(page.getByText('1 of the 3 needed')).toBeVisible();
  await typeIn(page, `${made.partA}\n${made.partB[1]}`);
  await expect(page.getByText('Sheet 2 is already in.')).toBeVisible();

  await typeIn(page, other.part_b[2].join('\n'));
  await expect(page.getByText('Sheet 3’s piece is damaged, or it comes from a different set.')).toBeVisible();
  await expect(page.getByText('1 of the 3 needed')).toBeVisible();
});

test('proving cannot be led astray by a sheet from an older set', async ({page}) => {
  const older = vectors.typed;
  await open(page);
  const made = await makeSheets(page);

  // The older sheet first: it is refused by its set code, and takes nothing over.
  await typeIn(page, [...older.part_a, ...older.part_b[0]].join('\n'));
  await expect(page.getByText(/This sheet is from a different set \(set code [0-9A-Z-]{14}\)\. Use the sheets you just printed\./)).toBeVisible();
  await expect(page.getByText('No sheets yet.')).toBeVisible();

  await typeIn(page, `${made.partA}\n${made.partB[0]}`);
  await typeIn(page, made.partB[1]!);
  await page.getByRole('button', {name: 'Start this check again'}).click();
  await expect(page.getByText('No sheets yet.')).toBeVisible();

  await typeIn(page, `${made.partA}\n${made.partB[2]}`);
  await typeIn(page, made.partB[3]!);
  await typeIn(page, made.partB[4]!);
  await expect(page.getByText('These sheets work.')).toBeVisible();
});

test('two sheets that disagree are both in doubt, and the page says so', async ({page}) => {
  const other = vectors.typed;
  await open(page);
  const made = await makeSheets(page);
  await finishUnchecked(page);
  await page.getByRole('button', {name: 'Recover a secret'}).click();
  await typeIn(page, `${made.partA}\n${made.partB[0]}`);
  await typeIn(page, [...other.part_a, ...other.part_b[2]].join('\n'));
  await expect(page.getByText('This sheet does not match the first one added. One of the two is from a different set')).toBeVisible();
  await expect(page.getByText('1 of the 3 needed')).toBeVisible();
});

test('finishing without checking the printed sheets takes a second, deliberate press', async ({page}) => {
  await open(page);
  const made = await makeSheets(page, {needed: 2, total: 3});
  await page.getByRole('button', {name: 'Finish and clear'}).click();
  await expect(page.getByText('You have not checked the printed sheets.')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Your sheets are ready'})).toBeVisible();

  // Checking after all takes the warning away again.
  await typeIn(page, `${made.partA}\n${made.partB[0]}`);
  await typeIn(page, made.partB[1]!);
  await expect(page.getByText('These sheets work.')).toBeVisible();
  await expect(page.getByText('You have not checked the printed sheets.')).toBeHidden();
  await page.getByRole('button', {name: 'Start this check again'}).click();

  await page.getByRole('button', {name: 'Finish and clear'}).click();
  // A double-click: its second click must not choose something on the next screen.
  await page.getByRole('button', {name: 'Finish without checking'}).dblclick();
  await expect(page.getByText('Cleared. You can close this tab now.')).toBeVisible();
  await expect(page.getByRole('heading', {level: 1, name: 'Secret Sheets'})).toBeVisible();
});

test('a sheet can be checked by itself, and says nothing of the secret', async ({page}) => {
  await open(page);
  const made = await makeSheets(page, {label: 'Safe'});
  await finishUnchecked(page);
  await page.getByRole('button', {name: 'Check a sheet'}).click();
  await typeIn(page, `${made.partA}\n${made.partB[2]}`);
  await expect(page.getByRole('heading', {name: 'This sheet is intact.'})).toBeVisible();
  await expect(page.getByText('Sheet 3 of 5 for “Safe”.')).toBeVisible();
  await expect(page.getByText('Any 3 of the 5 sheets recover the secret.')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(SECRET);

  // What was said about one sheet is not left standing beside the next.
  await typeIn(page, made.partA);
  await expect(page.getByText('Part B of this sheet was not found.')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'This sheet is intact.'})).toBeHidden();
  await typeIn(page, `${made.partA}\n${made.partB[2]}`);
  await expect(page.getByRole('heading', {name: 'This sheet is intact.'})).toBeVisible();
  await page.getByLabel('The lines from the sheet').fill('');
  await page.getByRole('button', {name: 'Check this sheet'}).click();
  await expect(page.getByText('Type the lines from the sheet first.')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'This sheet is intact.'})).toBeHidden();

  // This set's Part A with another set's piece.
  await typeIn(page, [made.partA, ...vectors.typed.part_b[2]].join('\n'));
  await expect(page.getByRole('heading', {name: 'This sheet will not work.'})).toBeVisible();
  await expect(page.getByText('Its Part B is not the one that belongs to sheet 3 of this set.')).toBeVisible();
});

test('the rule is explained as it is chosen, and impossible ones cannot be set', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Split a secret'}).click();
  await expect(page.getByText('Any 3 of the 5 sheets recover the secret.')).toBeVisible();
  await expect(page.getByText('If 2 are lost, you can still recover it. If 3 are lost, you cannot.')).toBeVisible();

  const people = (way: string) => page.getByRole('button', {name: `How many people get a sheet: One ${way}`});
  const needed = (way: string) => page.getByRole('button', {name: `How many sheets are needed: One ${way}`});
  await needed('more').click();
  await needed('more').click();
  await expect(page.getByText('All 5 sheets are needed to recover the secret.')).toBeVisible();
  await expect(page.getByText('If even one is lost, the secret is gone for good.')).toBeVisible();
  await expect(needed('more')).toBeDisabled();

  for (let i = 0; i < 3; i++) await people('fewer').click();
  await expect(page.getByText('Both sheets are needed to recover the secret.')).toBeVisible();
  await expect(people('fewer')).toBeDisabled();
  await expect(needed('fewer')).toBeDisabled();
  // Fewer people did not change what was asked for: with five again, five are needed.
  for (let i = 0; i < 3; i++) await people('more').click();
  await expect(page.getByText('All 5 sheets are needed to recover the secret.')).toBeVisible();
  for (let i = 0; i < 15; i++) await people('more').click();
  await expect(people('more')).toBeDisabled();
  await expect(page.getByText('Any 5 of the 20 sheets recover the secret.')).toBeVisible();
});

test('a secret or label that cannot go on a sheet is refused in plain words', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Split a secret'}).click();
  const make = page.getByRole('button', {name: 'Make the sheets'});

  await make.click();
  await expect(page.getByText('Type the secret first.')).toBeVisible();
  await page.getByLabel('The secret').fill('  \n ');
  await make.click();
  await expect(page.getByText('Type the secret first.')).toBeVisible();

  await page.getByLabel('The secret').fill('x'.repeat(400));
  await expect(page.getByText('Nearly full: 400 of 510 bytes.')).toBeVisible();
  await page.getByLabel('The secret').fill('é'.repeat(256));
  const tooLong = page.getByText('Too long to fit on a sheet: it takes 512 bytes, and the limit is 510.');
  await expect(tooLong).toHaveCount(1);
  await make.click();
  await expect(tooLong).toHaveCount(2);

  // 23 characters, but 69 bytes: said at once, in the same words as on refusal.
  await page.getByLabel('The secret').fill(SECRET);
  await page.getByLabel('What it is for (optional)').fill('密'.repeat(23));
  await expect(page.getByText('This is too long to print on every sheet. Shorten it.')).toBeVisible();
  await make.click();
  await expect(page.getByText('“What it is for” is too long to print on every sheet.')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Split a secret'})).toBeVisible();

  // A name that would be read as a line of a sheet, if a sheet's words were
  // ever copied into the page along with its lines.
  await page.getByLabel('What it is for (optional)').fill('Vitamins');
  await page.getByLabel('Your name (optional)').fill('Vitamin B12 Ltd');
  await make.click();
  await expect(page.getByText('Part of “Vitamin B12 Ltd” looks like a line of a sheet')).toBeVisible();
  await page.getByLabel('Your name (optional)').fill('Vitamin Bee Twelve Ltd');
  await make.click();
  await expect(page.getByRole('heading', {name: 'Your sheets are ready'})).toBeVisible();
});

test('names are printed on the sheets, and survive a change of plan', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Split a secret'}).click();
  await page.getByLabel('The secret').fill(SECRET);
  await page.getByLabel('Your name (optional)').fill('  Ama   Mensah ');
  await page.getByLabel('Sheet 1', {exact: true}).fill('Ama');
  await page.getByLabel('Sheet 2', {exact: true}).fill('Kofi');
  await page.getByLabel('Sheet 5', {exact: true}).fill('Abena');
  await page.getByRole('button', {name: 'How many people get a sheet: One fewer'}).click();
  await expect(page.getByLabel('Sheet 2', {exact: true})).toHaveValue('Kofi');
  await page.getByRole('button', {name: 'How many people get a sheet: One more'}).click();
  await expect(page.getByLabel('Sheet 5', {exact: true})).toHaveValue('Abena');

  // Enter in a one-line field does not make the sheets before the form is done.
  await page.getByLabel('Sheet 5', {exact: true}).press('Enter');
  await expect(page.getByRole('heading', {name: 'Split a secret'})).toBeVisible();

  await page.getByRole('button', {name: 'Make the sheets'}).click();
  const second = page.locator('.sheet').nth(1);
  await expect(second).toContainText('for Kofi');
  await expect(second).toContainText('Ama Mensah has trusted you with one of 5 sheets.');
  await expect(second).toContainText('If you lose it, tell Ama Mensah.');
  await expect(second.locator('.facts')).toContainText('From');
  await expect(page.locator('.sheet').nth(2).locator('.holder')).toHaveCount(0);

  // Changing one's mind keeps what was typed, and makes a different set.
  const firstCode = await page.locator('.lead strong').innerText();
  await page.getByRole('button', {name: 'Go back and change something'}).click();
  await expect(page.getByLabel('The secret')).toHaveValue(SECRET);
  await expect(page.getByLabel('Sheet 2', {exact: true})).toHaveValue('Kofi');
  await page.getByRole('button', {name: 'Make the sheets'}).click();
  await expect(page.locator('.lead strong')).not.toHaveText(firstCode);
});

test('a sheet says what it is in words that fit its rule', async ({page}) => {
  await open(page);
  await makeSheets(page, {needed: 2, total: 2});
  const sheet = page.locator('.sheet').first();
  await expect(sheet).toContainText('Someone has trusted you with one of 2 sheets. The two together unlock a secret.');
  await expect(sheet).toContainText('Bring both sheets together');
  await expect(sheet).toContainText('Do not keep a photo or a copy of it on a phone, on a computer or online.');
  await expect(sheet).toContainText('copy every line of Part A and Part B, including the two characters at the end');
  await expect(sheet).toContainText('Part B (sheet 1 of 2 only)');
  await expect(sheet.locator('.address')).toHaveText('The page is at https://hermit005-io.github.io/secret-sheets/');
  await expect(page.getByText('take both of the sheets you just printed')).toBeVisible();
});

test('the browser’s Back button returns to the start, and keeps nothing', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Split a secret'}).click();
  await page.goBack();
  await expect(page.getByRole('heading', {level: 1, name: 'Secret Sheets'})).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('heading', {name: 'Split a secret'})).toBeVisible();

  // With a secret typed, a slip of the finger does not throw it away...
  await page.getByLabel('The secret').fill(SECRET);
  await page.goBack();
  await expect(page.getByText('Not finished: nothing has been cleared yet.')).toBeVisible();
  await expect(page.getByLabel('The secret')).toHaveValue(SECRET);
  // ...the warning goes when the person carries on, and comes back next time...
  await page.getByLabel('Your name (optional)').fill('Ama');
  await expect(page.getByText('Not finished: nothing has been cleared yet.')).toBeHidden();
  await page.getByRole('button', {name: 'Make the sheets'}).click();
  await expect(page.getByRole('heading', {name: 'Your sheets are ready'})).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Not finished: nothing has been cleared yet.')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(5);
  // ...and going back a second time is taken at its word.
  await page.goBack();
  await expect(page.getByRole('heading', {level: 1, name: 'Secret Sheets'})).toBeFocused();
  await expect(page.locator('body')).not.toContainText(SECRET);
  await page.goForward();
  await expect(page.getByRole('heading', {name: 'Split a secret'})).toBeVisible();
  await expect(page.getByLabel('The secret')).toHaveValue('');

  // The page's own way back and the browser's are the same step.
  await page.getByRole('button', {name: 'Back to the start'}).click();
  await page.getByRole('button', {name: 'Check a sheet'}).click();
  await page.goBack();
  await expect(page.getByRole('heading', {level: 1, name: 'Secret Sheets'})).toBeVisible();
  expect(page.url()).toBe(PAGE);
});

// ---- the promises the page makes about itself ---------------------------------------

test('the page asks for nothing from the network', async ({page}) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await open(page);
  const made = await makeSheets(page);
  await typeIn(page, `${made.partA}\n${made.partB[0]}`);
  await finishUnchecked(page);
  await page.getByRole('button', {name: 'Recover a secret'}).click();
  await page.getByRole('button', {name: 'Back to the start'}).click();
  await page.getByRole('button', {name: 'Check a sheet'}).click();
  expect(requests).toEqual([PAGE]);
});

test('and its security policy refuses what an intruding script would try', async ({page}) => {
  // Fetching, loading a picture, adding a script and opening a frame are all
  // refused. (This test does not use open(), because here the page is meant
  // to log errors.)
  await page.goto(PAGE);
  const attempts = await page.evaluate(async () => {
    const blocked: string[] = [];
    document.addEventListener('securitypolicyviolation', event => blocked.push(event.violatedDirective));
    await fetch('https://example.com/?leak').catch(() => blocked.push('fetch failed'));
    const image = new Image();
    image.src = 'https://example.com/pixel.png';
    const script = document.createElement('script');
    script.textContent = 'window.injected = true';
    document.body.append(script);
    const frame = document.createElement('iframe');
    frame.src = 'https://example.com/';
    document.body.append(frame);
    await new Promise(resolve => setTimeout(resolve, 300));
    return {blocked, injected: 'injected' in window};
  });
  expect(attempts.injected).toBe(false);
  expect(attempts.blocked).toContain('fetch failed');
  for (const directive of ['connect-src', 'img-src', 'script-src-elem', 'frame-src']) {
    expect(attempts.blocked, directive).toContain(directive);
  }
});

test('it works with the internet switched off', async ({page, context}) => {
  await context.setOffline(true);
  await open(page);
  const made = await makeSheets(page, {needed: 2, total: 3});
  await typeIn(page, `${made.partA}\n${made.partB[0]}`);
  await typeIn(page, made.partB[2]!);
  await expect(page.getByText('These sheets work.')).toBeVisible();
});

test('nothing is kept in the browser after the page is used', async ({page}) => {
  await open(page);
  await makeSheets(page);
  const kept = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookies: document.cookie,
    address: location.search + location.hash,
    history: JSON.stringify(history.state),
  }));
  expect(kept).toEqual({local: 0, session: 0, cookies: '', address: '', history: '{"screen":"split"}'});
});

test('every screen passes the accessibility checks', async ({page}) => {
  const check = async (where: string) => {
    const results = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(violation => `${where}: ${violation.id}`)).toEqual([]);
  };
  await open(page);
  await check('home');
  await page.getByRole('button', {name: 'Recover a secret'}).click();
  await page.getByRole('button', {name: 'Type it in'}).click();
  await typeIn(page, 'A01 0000');
  await check('recover, with a mistake showing');
  const {part_a, part_b} = vectors.typed;
  await typeIn(page, [...part_a, ...part_b[0]].join('\n'));
  await typeIn(page, part_b[1].join('\n'));
  await typeIn(page, part_b[2].join('\n'));
  await expect(page.locator('.secret')).toBeVisible();
  await check('recover, with the secret showing');
  await page.getByRole('button', {name: 'Back to the start'}).click();
  await page.getByRole('button', {name: 'Check a sheet'}).click();
  await typeIn(page, [...part_a, ...part_b[0]].join('\n'));
  await check('check, with a report showing');
  await page.getByRole('button', {name: 'Back to the start'}).click();
  await page.getByRole('button', {name: 'Split a secret'}).click();
  await check('split');
  await page.getByRole('button', {name: 'Make the sheets'}).click();
  await page.getByLabel('What it is for (optional)').fill('密'.repeat(23));
  await check('split, with refusals showing');
  await page.getByLabel('What it is for (optional)').fill('Safe');
  await page.getByLabel('The secret').fill(SECRET);
  await page.getByRole('button', {name: 'Make the sheets'}).click();
  await expect(page.locator('.sheet')).toHaveCount(5);
  await page.getByRole('button', {name: 'Finish and clear'}).click();
  await check('ready, with the warning showing');
});

test('a set is made, proved and recovered with the keyboard alone', async ({page}) => {
  // Tab until the thing with this name has the keyboard, as a person would.
  const tabTo = async (name: string | RegExp) => {
    for (let presses = 0; presses < 60; presses++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const label = element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent : '';
        return `${element.getAttribute('aria-label') ?? ''}|${label}|${element.textContent}`;
      });
      if (focused.split('|').some(text => (typeof name === 'string' ? text === name : name.test(text)))) return;
    }
    throw new Error(`Tab never reached ${name}`);
  };
  const typeSheet = async (lines: string) => {
    await tabTo('The lines from the sheet');
    await page.keyboard.insertText(lines);
    await tabTo('Add this sheet');
    await page.keyboard.press('Enter');
  };

  await open(page);
  await tabTo(/^Split a secret/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name: 'Split a secret'})).toBeFocused();
  await tabTo('The secret');
  await page.keyboard.type(SECRET);
  // Down to two people: the button that reaches its limit hands on the keyboard.
  await tabTo('How many people get a sheet: One fewer');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: 'How many people get a sheet: One more'})).toBeFocused();
  await tabTo('Make the sheets');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name: 'Your sheets are ready'})).toBeFocused();
  const partA = await page.locator('.sheet .part-a').first().innerText();
  const partB = await page.locator('.sheet .part-b').allInnerTexts();

  await tabTo('Type it in');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(`${partA}\n${partB[0]}`);
  await tabTo('Add this sheet');
  await page.keyboard.press('Enter');
  await typeSheet(partB[1]!);
  await expect(page.getByText('These sheets work.')).toBeVisible();
  await tabTo('Finish and clear');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {level: 1, name: 'Secret Sheets'})).toBeFocused();

  await tabTo(/^Recover a secret/);
  await page.keyboard.press('Enter');
  await tabTo('Type it in');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(`${partA}\n${partB[1]}`);
  await tabTo('Add this sheet');
  await page.keyboard.press('Enter');
  await typeSheet(partB[0]!);
  await expect(page.locator('.secret')).toBeFocused();
  await expect(page.locator('.secret')).toHaveText(SECRET);
  await page.keyboard.press('Shift+Tab'); // "Clear and start again"
  await page.keyboard.press('Enter');
  await expect(page.locator('.secret')).toBeHidden();
});

test('on a small phone nothing runs off the side, and the secret appears in view', async ({browser}) => {
  const page = await browser.newPage({viewport: {width: 320, height: 640}});
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await open(page);
  expect(await fits()).toBe(true);

  await page.getByRole('button', {name: 'Split a secret'}).click();
  await page.getByLabel('Sheet 1', {exact: true}).fill('Wolfeschlegelsteinhausenbergerdorff-Smith');
  await page.getByRole('button', {name: 'Back to the start'}).click();
  // (Names are not kept between visits, so type it again in the set that is made.)
  await page.getByRole('button', {name: 'Split a secret'}).click();
  await page.getByLabel('Sheet 1', {exact: true}).fill('Wolfeschlegelsteinhausenbergerdorff-Smith');
  await page.getByLabel('The secret').fill('x'.repeat(200));
  await page.getByLabel('What it is for (optional)').fill('A fairly long label for a narrow screen');
  await page.getByRole('button', {name: 'Make the sheets'}).click();
  await expect(page.locator('.sheet')).toHaveCount(5);
  expect(await fits()).toBe(true);

  const partA = await page.locator('.sheet .part-a').first().innerText();
  const partB = await page.locator('.sheet .part-b').allInnerTexts();
  await finishUnchecked(page);
  await page.getByRole('button', {name: 'Recover a secret'}).click();
  await typeIn(page, `${partA}\n${partB[0]}`);
  expect(await fits()).toBe(true);
  await typeIn(page, partB[1]!);
  await typeIn(page, partB[2]!);
  await expect(page.locator('.secret')).toBeInViewport();
  expect(await fits()).toBe(true);
});
