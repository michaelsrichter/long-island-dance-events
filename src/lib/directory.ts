/** Helpers for the directory pages (venues, bands and DJs, teachers, organizers, dance styles). */
import type { ImageMetadata } from 'astro';

/** A logo or photo as stored in content (after Astro has resolved the file). */
export interface EntityImageData {
  image: ImageMetadata;
  /** Required for photos; optional for logos (pages then say "<name> logo"). */
  alt?: string | undefined;
  focus?: string | undefined;
  caption?: string | undefined;
  credit?: string | undefined;
  creditUrl?: string | undefined;
  licenseUrl?: string | undefined;
}

const SMALL_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'on', 'in', 'dj']);

/** Two letters for a card with no picture: "The Nutty Irishman" -> "NI", "89 North" -> "8N", "Swingtime" -> "SW". */
export function initialsOf(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const main = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  const use = main.length ? main : words;
  if (use.length === 0) return '?';
  if (use.length === 1) return use[0]!.slice(0, 2).toUpperCase();
  return (use[0]![0]! + use[1]![0]!).toUpperCase();
}

/** Lowercase text without accents, for the directory search box. */
export function searchText(...parts: (string | undefined | null | false)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The picture a card shows first: the first photo, else the logo. */
export function cardMedia(d: { logo?: EntityImageData | undefined; photos?: EntityImageData[] | undefined }): { photo?: EntityImageData; logo?: EntityImageData } {
  const photo = d.photos?.[0];
  return { ...(photo ? { photo } : {}), ...(d.logo ? { logo: d.logo } : {}) };
}

/** "1 coming up" / "12 coming up". */
export function upcomingLabel(n: number): string {
  return n > 0 ? `${n} coming up` : 'Nothing listed now';
}

/**
 * Image settings shared by every directory picture. Photos: 16:9 crops at 400 and 800 pixels wide;
 * logos: their own shape at 160 and 320. Using the same settings everywhere (cards, page tops,
 * galleries, JSON-LD) means Astro makes each file once. Never asks for more pixels than the original has.
 */
export function entityImageOptions(src: ImageMetadata, kind: 'photo' | 'logo', focus?: string) {
  // SVGs are passed through as they are: Astro's image service cannot convert them (it throws), and they scale cleanly.
  if (src.format === 'svg') {
    const w = src.width || 320;
    const h = src.height || Math.round(w / 2);
    const width = Math.min(w, 320);
    return { widths: undefined, width, height: Math.round((width * h) / w), format: 'svg' as const };
  }
  const aspect = kind === 'photo' ? 16 / 9 : undefined;
  const wanted = kind === 'photo' ? [400, 800] : [160, 320];
  const maxW = aspect ? Math.min(src.width, Math.floor(src.height * aspect)) : src.width;
  const usable = wanted.filter((w) => w <= maxW);
  const widths = usable.length ? usable : [maxW];
  const width = Math.max(...widths);
  const height = aspect ? Math.round(width / aspect) : Math.round((width * src.height) / src.width);
  return {
    widths,
    width,
    height,
    format: 'webp' as const,
    quality: kind === 'logo' ? 86 : 72,
    ...(aspect ? { fit: 'cover' as const, position: focus ?? '50% 50%' } : {}),
  };
}

/**
 * `sizes` for a logo that never asks the browser to show it wider than its file (a 160-pixel logo in a
 * 12rem box stays 160 pixels wide instead of being stretched and blurry). Takes a single length such as "12rem".
 */
export function logoSizes(sizes: string, fileWidth: number): string {
  const m = sizes.trim().match(/^(\d+(?:\.\d+)?)(rem|px)$/);
  if (!m || !fileWidth) return sizes;
  const px = Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
  return px > fileWidth ? `${fileWidth}px` : sizes;
}
