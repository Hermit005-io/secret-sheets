import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {expect} from '@playwright/test';
import type {Page} from '@playwright/test';

// The built page, opened from disk the way a saved copy would be.
export const PAGE = new URL('../dist/secret-sheets.html', import.meta.url).href;

export const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../tests/vectors/sheets_v1.json', import.meta.url)), 'utf8'),
);

export const SECRET = 'correct horse battery staple';

/** Open the page and fail the test on any error it reports from then on. */
export async function open(page: Page): Promise<void> {
  page.on('pageerror', error => {
    throw error;
  });
  page.on('console', message => {
    if (message.type() === 'error') throw new Error(`the page logged an error: ${message.text()}`);
  });
  await page.goto(PAGE);
  await expect(page.getByRole('heading', {level: 1, name: 'Secret Sheets'})).toBeVisible();
}

export interface Made {
  partA: string;
  partB: string[]; // one per sheet
}

/** Go through "Split a secret" and return what the sheets say. */
export async function makeSheets(
  page: Page,
  options: {secret?: string; needed?: number; total?: number; label?: string; owner?: string; holder?: string} = {},
): Promise<Made> {
  const {secret = SECRET, needed = 3, total = 5, label = '', owner = '', holder = ''} = options;
  await page.getByRole('button', {name: 'Split a secret'}).click();
  await page.getByLabel('The secret').fill(secret);
  if (label) await page.getByLabel('What it is for (optional)').fill(label);
  if (owner) await page.getByLabel('Your name (optional)').fill(owner);

  const press = async (name: string, times: number) => {
    for (let i = 0; i < Math.abs(times); i++) {
      await page.getByRole('button', {name: `${name}: One ${times > 0 ? 'more' : 'fewer'}`}).click();
    }
  };
  // Needed can never exceed the number of sheets, so the order depends on direction.
  if (total >= 5) {
    await press('How many people get a sheet', total - 5);
    await press('How many sheets are needed', needed - 3);
  } else {
    await press('How many sheets are needed', Math.min(needed, total) - 3);
    await press('How many people get a sheet', total - 5);
  }

  if (holder) await page.getByLabel('Sheet 1', {exact: true}).fill(holder);
  await page.getByRole('button', {name: 'Make the sheets'}).click();
  await expect(page.getByRole('heading', {name: 'Your sheets are ready'})).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(total);
  return {
    partA: await page.locator('.sheet .part-a').first().innerText(),
    partB: await page.locator('.sheet .part-b').allInnerTexts(),
  };
}

/** Finish with a set that has not been read back, which takes a second press. */
export async function finishUnchecked(page: Page): Promise<void> {
  await page.getByRole('button', {name: 'Finish and clear'}).click();
  await page.getByRole('button', {name: 'Finish without checking'}).click();
  await expect(page.getByText('Cleared.')).toBeVisible();
}

/** Type one sheet (or one part of one) into whichever reader is on screen. */
export async function typeIn(page: Page, lines: string): Promise<void> {
  const box = page.getByLabel('The lines from the sheet');
  if (!(await box.isVisible())) await page.getByRole('button', {name: 'Type it in'}).click();
  await box.fill(lines);
  await page.getByRole('button', {name: /^(Add|Check) this sheet$/}).click();
}
