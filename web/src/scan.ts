// Reading a sheet's QR code from the camera or from a photo. Nothing is sent
// anywhere: the picture is decoded on this device.
//
// Where the browser has its own code reader (most phones do) that is used,
// because it copes better with blur and awkward angles. Everywhere else the
// jsQR library does the work.

import jsQR from 'jsqr';

// Not yet in TypeScript's description of the browser.
interface BarcodeDetector {
  detect(source: ImageBitmapSource): Promise<{rawValue: string}[]>;
}
declare const BarcodeDetector: (new (options: {formats: string[]}) => BarcodeDetector) | undefined;

let builtIn: BarcodeDetector | null | undefined;

async function builtInReader(): Promise<BarcodeDetector | null> {
  if (builtIn === undefined) {
    try {
      builtIn = typeof BarcodeDetector === 'function' ? new BarcodeDetector({formats: ['qr_code']}) : null;
    } catch {
      builtIn = null;
    }
  }
  return builtIn;
}

async function readWithBuiltIn(source: ImageBitmapSource): Promise<string | null> {
  try {
    const found = await (await builtInReader())?.detect(source);
    return found?.[0]?.rawValue ?? null;
  } catch {
    return null; // some browsers have the reader but not for this kind of source
  }
}

/** The text of a QR code found in `image`, or null. */
export function decode(image: ImageData): string | null {
  return jsQR(image.data, image.width, image.height, {inversionAttempts: 'dontInvert'})?.data ?? null;
}

type Picture = ImageBitmap | HTMLVideoElement;

/** Decode the part of `picture` starting at (x, y), drawn `scale` times its size. */
function decodeRegion(picture: Picture, x: number, y: number, width: number, height: number, scale: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', {willReadFrequently: true})!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return decode(context.getImageData(0, 0, canvas.width, canvas.height));
}

// A code needs about three pixels to each of its squares to be read, and the
// largest sheet's code is 113 squares across. A phone photo of a whole sheet
// has that to spare, but decoding at full size takes seconds, so smaller
// copies are tried first.
const PHOTO_SIZES = [1600, 2600];

export async function decodePhoto(file: Blob): Promise<string | null> {
  const photo = await createImageBitmap(file);
  try {
    const native = await readWithBuiltIn(photo);
    if (native) return native;

    const {width, height} = photo;
    for (const longest of PHOTO_SIZES) {
      const scale = Math.min(1, longest / Math.max(width, height));
      const text = decodeRegion(photo, 0, 0, width, height, scale);
      if (text) return text;
      if (scale === 1) break; // the photo is smaller than this; nothing more to gain
    }

    // Still nothing: the code is small in the frame. Look at the photo in
    // overlapping windows half its width and height, at full sharpness, so
    // that wherever the code is, one window holds all of it.
    for (const top of [0, 0.25, 0.5]) {
      for (const left of [0.5, 0.25, 0]) {
        const text = decodeRegion(photo, left * width, top * height, width / 2, height / 2, 1);
        if (text) return text;
      }
    }
    return null;
  } finally {
    photo.close();
  }
}

export interface Camera {
  stop(): void;
}

/**
 * Show the camera in `video` and call `onText` with each QR code seen, until
 * stopped. Rejects if there is no camera or permission is refused.
 */
export async function startCamera(video: HTMLVideoElement, onText: (text: string) => void): Promise<Camera> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {facingMode: 'environment', width: {ideal: 1920}, height: {ideal: 1080}},
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  let running = true;
  let lastLook = 0;
  let looking = false;

  const look = async (now: number) => {
    if (!running) return;
    requestAnimationFrame(look);
    // Five looks a second is plenty, and leaves the page responsive.
    if (looking || now - lastLook < 200 || video.videoWidth === 0) return;
    lastLook = now;
    looking = true;
    try {
      const text =
        (await readWithBuiltIn(video)) ?? decodeRegion(video, 0, 0, video.videoWidth, video.videoHeight, 1);
      if (text && running) onText(text);
    } finally {
      looking = false;
    }
  };
  requestAnimationFrame(look);

  return {
    stop() {
      running = false;
      stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    },
  };
}
