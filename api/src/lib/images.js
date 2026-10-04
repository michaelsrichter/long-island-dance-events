'use strict';
/**
 * Photo cleaning: check the real file type, apply the camera rotation, remove ALL metadata
 * (EXIF, GPS location, camera owner), and save three WebP sizes. The original is never stored.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SIZES = [480, 1024, 2048];

/** Identify the format from the first bytes, not the file name. */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'heic';
  return null;
}

let sharpLib;
function loadSharp() {
  if (sharpLib === undefined) {
    try {
      sharpLib = require('sharp');
    } catch {
      sharpLib = null;
    }
  }
  return sharpLib;
}

/**
 * Returns { ok: true, width, height, variants: [{ px, buffer, width, height }] }
 * or { ok: false, code, message }.
 */
async function processPhoto(buf) {
  if (!buf || !buf.length) return { ok: false, code: 'empty', message: 'Please choose a photo.' };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, code: 'too_large', message: 'That photo is too big. Please use one under 10 MB.' };
  const kind = sniff(buf);
  if (kind === 'heic') return { ok: false, code: 'heic', message: 'Please share the photo as a JPEG (most phones convert it for you when you upload from the browser).' };
  if (!kind) return { ok: false, code: 'bad_type', message: 'Please upload a JPEG, PNG or WebP photo.' };
  const sharp = loadSharp();
  if (!sharp) return { ok: false, code: 'unavailable', message: 'Photo uploads are not working right now. Please try again later.' };
  try {
    const base = sharp(buf, { failOn: 'error', limitInputPixels: 60_000_000 }).rotate();
    const meta = await base.metadata();
    const w0 = meta.autoOrient ? meta.autoOrient.width : meta.width;
    const h0 = meta.autoOrient ? meta.autoOrient.height : meta.height;
    if (!w0 || !h0 || w0 < 200 || h0 < 200) return { ok: false, code: 'too_small', message: 'That photo is too small. Please use one at least 200 pixels wide.' };
    const variants = [];
    for (const px of SIZES) {
      // sharp drops all metadata unless asked to keep it; the output has no EXIF or GPS.
      const { data, info } = await sharp(buf, { failOn: 'error', limitInputPixels: 60_000_000 })
        .rotate()
        .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: px <= 480 ? 72 : 80 })
        .toBuffer({ resolveWithObject: true });
      variants.push({ px, buffer: data, width: info.width, height: info.height });
    }
    const largest = variants[variants.length - 1];
    return { ok: true, width: largest.width, height: largest.height, variants };
  } catch {
    return { ok: false, code: 'unreadable', message: 'We could not read that photo. Please try another one.' };
  }
}

module.exports = { processPhoto, sniff, MAX_UPLOAD_BYTES, SIZES };
