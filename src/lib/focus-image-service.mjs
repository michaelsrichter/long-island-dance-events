/**
 * Astro image service: the built-in sharp service, plus precise focus-point crops.
 *
 * Sharp's own `position` only knows nine fixed spots ("top", "left", ...). Here a `position` such as
 * "35% 40%" means "keep the point 35% from the left and 40% from the top as close to the middle as
 * possible" when an image is cropped to a new shape (fit: cover). Other values behave as before.
 */
import sharpService from 'astro/assets/services/sharp';
import sharp from 'sharp';

const FOCUS = /^(\d{1,3})% (\d{1,3})%$/;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** Pixel box of the largest region with the target aspect ratio, centered on the focus point. */
export function focusBox(width, height, aspect, fx, fy) {
  let w = width;
  let h = height;
  if (width / height > aspect) w = Math.round(height * aspect);
  else h = Math.round(width / aspect);
  const left = clamp(Math.round(fx * width - w / 2), 0, width - w);
  const top = clamp(Math.round(fy * height - h / 2), 0, height - h);
  return { left, top, width: w, height: h };
}

/** @type {import('astro').LocalImageService} */
const service = {
  ...sharpService,
  async transform(inputBuffer, options, config, logger) {
    const m = typeof options.position === 'string' ? options.position.match(FOCUS) : null;
    if (!m || options.fit !== 'cover' || !options.width || !options.height) {
      return sharpService.transform(inputBuffer, options, config, logger);
    }
    const oriented = sharp(inputBuffer, { failOn: 'none' }).rotate();
    const { width, height } = await sharp(await oriented.toBuffer()).metadata();
    if (!width || !height) return sharpService.transform(inputBuffer, options, config, logger);
    const box = focusBox(width, height, options.width / options.height, Number(m[1]) / 100, Number(m[2]) / 100);
    // Lossless intermediate so the final encode is the only compression step.
    const cropped = await sharp(inputBuffer, { failOn: 'none' }).rotate().extract(box).png().toBuffer();
    return sharpService.transform(cropped, { ...options, fit: 'fill', position: undefined }, config, logger);
  },
};

export default service;
