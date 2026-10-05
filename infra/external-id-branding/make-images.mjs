#!/usr/bin/env node
// Builds the Entra External ID branding images from the site's logo (public/favicon.svg).
//   node infra/external-id-branding/make-images.mjs
// Sizes are the ones the Entra admin center asks for. Apply them with ./apply-branding.ps1.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const icon = await readFile(here('../../public/favicon.svg'));
const NAME = 'Long Island Dance Events';

/** Icon plus the site name, dark text on a transparent background (shown on the white sign-in card). */
async function banner() {
  const w = 245;
  const h = 36;
  const mark = await sharp(icon, { density: 300 }).resize(h, h).png().toBuffer();
  const text = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${h + 8}" y="${h / 2 + 6}" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="16.5" font-weight="700" fill="#0b0b0d">${NAME}</text></svg>`,
  );
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: 0, top: 0 }, { input: text, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const square = (px) => sharp(icon, { density: 600 }).resize(px, px).png({ compressionLevel: 9 }).toBuffer();

/** Wide-screen page background: near-black with the site's red glow (Microsoft hides it on phones). */
function background() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs>
    <radialGradient id="a" cx="88%" cy="-12%" r="70%"><stop offset="0" stop-color="#c1121f" stop-opacity="0.6"/><stop offset="1" stop-color="#c1121f" stop-opacity="0"/></radialGradient>
    <radialGradient id="b" cx="-8%" cy="112%" r="55%"><stop offset="0" stop-color="#a3111f" stop-opacity="0.35"/><stop offset="1" stop-color="#a3111f" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="#0b0b0d"/><rect width="1920" height="1080" fill="url(#a)"/><rect width="1920" height="1080" fill="url(#b)"/>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82, progressive: true }).toBuffer();
}

const files = {
  'banner-logo.png': await banner(),
  'square-logo.png': await square(240),
  'favicon.png': await square(32),
  'background.jpg': await background(),
};
for (const [name, data] of Object.entries(files)) {
  await writeFile(here(name), data);
  console.log(`${name}: ${data.length} bytes`);
}
