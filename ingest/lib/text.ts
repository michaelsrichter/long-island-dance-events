/** Small text helpers shared by adapters. Listing text is data only, never instructions. */

export function slugify(s: string, max = 80): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // Cut at a word boundary: the longest prefix up to `max` that ends where a hyphen follows.
    .replace(new RegExp(`^(.{0,${max}})(-.*)?$`), '$1')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Lowercase, strip accents and punctuation, collapse spaces: for loose comparisons. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive phrase match on normalized text. */
export function containsPhrase(haystackNormalized: string, phrase: string): boolean {
  const p = normalizeText(phrase);
  if (!p) return false;
  return new RegExp(`(^| )${escapeRe(p)}( |$)`).test(haystackNormalized);
}

/** Tidy PDF artifacts: spaced web addresses, stray running headers, doubled spaces. */
export function cleanListingText(s: string): string {
  return s
    .replace(/\b(www)\.\s+/gi, '$1.')
    .replace(/@\s+(?=[a-z0-9])/gi, '@')
    .replace(/\.\s+(com|org|net|us|edu)\b/gi, '.$1')
    .replace(/\b[A-Z][a-z]+ \d{4} Dance Calendar\b/g, '')
    .replace(/\(Please call advertisers ahead to confirm\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractUrls(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|us|edu|info|biz|nyc|dance)(?:\/[^\s,;)]*)?)/gi)) {
    let u = m[1]!.replace(/[.,;:]+$/, '');
    if (/@/.test(s.slice(Math.max(0, m.index! - 1), m.index!))) continue; // part of an email address
    if (!/^https?:/i.test(u)) u = `https://${u.toLowerCase().startsWith('www.') ? u.toLowerCase() : u.toLowerCase()}`;
    out.add(u);
  }
  return [...out];
}

export function extractEmails(s: string): string[] {
  return [...new Set([...s.matchAll(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi)].map((m) => m[0].toLowerCase()))];
}

/** Phone numbers as "(631) 476-3707". Handles "631-476-3707", "631.476.3707", "(631) 476-3707", "631 242-0686". */
export function extractPhones(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(/\(?\b(\d{3})\)?[\s.-]{0,2}(\d{3})[\s.-]{1,2}(\d{4})\b/g)) out.add(`(${m[1]}) ${m[2]}-${m[3]}`);
  return [...out];
}

export const digits = (s: string) => s.replace(/\D/g, '');

/** Hostname without "www." for domain comparisons. */
export function domainOf(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function titleCaseWord(w: string): string {
  return w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

export function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}
