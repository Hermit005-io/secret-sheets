// Reading sheets back from pictures of them: a photo chosen from the device,
// and the live camera. These are the only tests that exercise the QR code
// end to end, drawn by one library and read by another.

import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {chromium, expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

import {PAGE, SECRET, makeSheets, open} from './helpers.ts';

/** A picture of sheet `index` as it appears on the page: text, code and all. */
const photoOf = (page: Page, index: number) => page.locator('.sheet').nth(index).screenshot();

async function choosePhoto(page: Page, png: Buffer): Promise<void> {
  await page.locator('.reader input[type=file]').setInputFiles({name: 'sheet.png', mimeType: 'image/png', buffer: png});
}

test('photos of the sheets are read', async ({page}) => {
  await open(page);
  await makeSheets(page, {label: 'Email recovery codes'});
  const photos = [await photoOf(page, 4), await photoOf(page, 0), await photoOf(page, 2)];

  await choosePhoto(page, photos[0]!);
  await expect(page.locator('.collected')).toHaveText('Sheet 5 of 5');
  await choosePhoto(page, photos[1]!);
  await choosePhoto(page, photos[2]!);
  await expect(page.getByText('These sheets work.')).toBeVisible();
});

test('a photo with no sheet in it says so', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Recover a secret'}).click();
  await choosePhoto(page, await page.locator('h1').screenshot());
  await expect(page.getByText('No sheet code was found in that photo.')).toBeVisible();
});

/** How many pages the sheets on screen take up when printed. */
async function pagesPrinted(page: Page, format: 'A4' | 'Letter'): Promise<number> {
  const pdf = (await page.pdf({format})).toString('latin1');
  return pdf.match(/\/Type\s*\/Page\b(?!s)/g)!.length;
}

// The width of A4 inside the page's 13 mm margins, in CSS pixels.
const PRINTED_WIDTH = Math.round(((210 - 2 * 13) / 25.4) * 96);

// Sheets are printed in the largest type that fits them on one page, which
// the page finds by measuring. Here are sets from the barest to the fullest
// a sheet can ever be (510 bytes of secret, 20 sheets, a 64-byte label), with
// names as long and as wide as names can be, in the page's own font and in
// two others far wider, standing in for devices that lack the first.
const W = (count: number) => 'W'.repeat(count);
const sets = {
  barest: {secret: 'x', needed: 2, total: 2},
  ordinary: {total: 5, label: 'Email recovery codes', owner: 'Ama Mensah', holder: 'Kofi'},
  'long-named': {total: 4, label: W(64), owner: 'M'.repeat(40), holder: W(40)},
  middling: {secret: W(254), total: 5, label: W(64), owner: 'M'.repeat(10)},
  fullest: {secret: W(510), needed: 2, total: 20, label: W(64), owner: 'M'.repeat(40), holder: W(40)},
};
const fonts = {'its own font': '', 'the device’s plain serif': 'serif', 'a typewriter font': 'monospace'};

for (const [fontName, font] of Object.entries(fonts)) {
  for (const [name, options] of Object.entries(sets)) {
    test(`the ${name} set prints one sheet to a page and scans, in ${fontName}`, async ({browser}) => {
      // Three device pixels to each CSS pixel pictures the printed layout at
      // about 290 dots to the inch, roughly a phone's photo of the page.
      const context = await browser.newContext({
        deviceScaleFactor: 3,
        viewport: {width: PRINTED_WIDTH, height: 1000},
        bypassCSP: font !== '', // only so that the test can swap the font
      });
      const page = await context.newPage();
      await open(page);
      if (font) await page.addStyleTag({content: `:root { --text: ${font}; }`});
      await makeSheets(page, options);
      const first = page.locator('.sheet').first();

      // Every sheet of a set is printed in the same size of type.
      const size = (await first.getAttribute('class'))!.replace('sheet ', '');
      await expect(page.locator(`.sheet.${size}`)).toHaveCount(options.total);
      if (name === 'ordinary' && !font) expect(size).toBe('size-1');

      await page.emulateMedia({media: 'print'});
      expect(await pagesPrinted(page, 'A4')).toBe(options.total);
      expect(await pagesPrinted(page, 'Letter')).toBe(options.total);

      // No typed line is cut off or runs into the next column.
      for (const part of await first.locator('.lines').all()) {
        const {widest, room} = await part.evaluate(lines => {
          const range = document.createRange();
          range.selectNodeContents(lines);
          const boxes = [...range.getClientRects()].filter(box => box.width > 0);
          const starts = [...new Set(boxes.map(box => Math.round(box.left)))].sort((x, y) => x - y);
          const edge = lines.getBoundingClientRect().right;
          return {widest: Math.max(...boxes.map(box => box.width)), room: (starts[1] ?? edge) - starts[0]!};
        });
        expect(widest).toBeLessThan(room);
      }

      const photos = [await photoOf(page, options.total - 1), await photoOf(page, 0)]; // as laid out for paper
      await page.emulateMedia({media: 'screen'});
      await choosePhoto(page, photos[0]!);
      await expect(page.locator('.collected')).toHaveText(`Sheet ${options.total} of ${options.total}`);
      await choosePhoto(page, photos[1]!);
      await expect(page.locator('.collected li')).toHaveCount(2);
      await context.close();
    });
  }
}

test('a camera allowed too late is not left running out of sight', async ({page}) => {
  // Permission is asked for, the person goes on to type instead, and only
  // then is the camera granted. (The "camera" here is a blank moving picture.)
  await open(page);
  await page.evaluate(() => {
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, {tracks});
    navigator.mediaDevices.getUserMedia = async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      setInterval(() => context.fillRect(0, 0, 1, 1), 50);
      const stream = canvas.captureStream(20);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
  const states = () =>
    page.evaluate(() => (window as unknown as {tracks: MediaStreamTrack[]}).tracks.map(track => track.readyState));

  await page.getByRole('button', {name: 'Recover a secret'}).click();
  await page.getByRole('button', {name: 'Use the camera'}).click();
  await page.getByRole('button', {name: 'Type it in'}).click();
  await expect.poll(states).toEqual(['ended']);
  await expect(page.locator('.camera')).toBeHidden();
  await expect(page.getByText('The camera could not be used.')).toBeHidden();

  // Left to itself, the same camera does come on, and goes off with the screen.
  await page.getByRole('button', {name: 'Use the camera'}).click();
  await expect(page.getByRole('button', {name: 'Stop the camera'})).toBeVisible();
  expect(await states()).toEqual(['ended', 'live']);
  await page.getByRole('button', {name: 'Back to the start'}).click();
  await expect.poll(states).toEqual(['ended', 'ended']);
});

test('the camera reads sheets held up to it one after another', async ({page}, testInfo) => {
  test.slow();
  await open(page);
  await makeSheets(page);

  // A short film of three sheets' codes, a second each, for Chromium to play
  // as if it were the camera.
  const size = {width: 640, height: 480};
  const frames: Buffer[] = [];
  for (const index of [1, 3, 4]) {
    const png = await page.locator('.sheet .code svg').nth(index).screenshot();
    frames.push(await yuvFrame(page, png, size));
  }
  const film = join(mkdtempSync(join(tmpdir(), 'sheets-')), 'camera.y4m');
  const header = Buffer.from(`YUV4MPEG2 W${size.width} H${size.height} F10:1 Ip A1:1 C420jpeg\n`);
  const shown = frames.flatMap(frame => Array.from({length: 10}, () => [Buffer.from('FRAME\n'), frame]).flat());
  writeFileSync(film, Buffer.concat([header, ...shown]));

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${film}`,
    ],
  });
  try {
    const watcher = await browser.newPage();
    await watcher.goto(PAGE);
    await watcher.getByRole('button', {name: 'Recover a secret'}).click();
    await watcher.getByRole('button', {name: 'Use the camera'}).click();
    await expect(watcher.locator('.secret')).toHaveText(SECRET, {timeout: 20_000});
    await expect(watcher.locator('.collected li')).toHaveText(['Sheet 2 of 5', 'Sheet 4 of 5', 'Sheet 5 of 5']);
    // Once the secret is out, the camera is switched off and put away.
    await expect(watcher.getByRole('button', {name: 'Use the camera'})).toBeHidden();
    expect(await watcher.locator('video').evaluate((video: HTMLVideoElement) => video.srcObject)).toBeNull();
  } finally {
    await browser.close();
    await testInfo.attach('camera film', {path: film});
  }
});

/** A PNG centred on a white frame, as one frame of raw I420 video. */
async function yuvFrame(page: Page, png: Buffer, size: {width: number; height: number}): Promise<Buffer> {
  const rgba = await page.evaluate(
    async ({base64, width, height}) => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const picture = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      const side = Math.min(width, height) - 40;
      context.imageSmoothingEnabled = false;
      context.drawImage(picture, (width - side) / 2, (height - side) / 2, side, side);
      return Array.from(context.getImageData(0, 0, width, height).data);
    },
    {base64: png.toString('base64'), ...size},
  );

  const {width, height} = size;
  const frame = Buffer.alloc(width * height * 1.5, 128); // U and V at 128: no colour
  for (let pixel = 0; pixel < width * height; pixel++) {
    const [r, g, b] = [rgba[4 * pixel]!, rgba[4 * pixel + 1]!, rgba[4 * pixel + 2]!];
    frame[pixel] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return frame;
}
