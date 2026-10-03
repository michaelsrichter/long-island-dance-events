/** Price parsing for free-text listings ("$25pp", "Adm. $35", "$18pp ($30 per couple)", "$12pp don"). */

export interface ParsedPrice {
  price?: number | undefined;
  priceMax?: number | undefined;
  isFree?: boolean | undefined;
  /** Short notes in our own words, e.g. "First class free for new students". */
  notes: string[];
}

export function parsePrices(text: string): ParsedPrice {
  const perPerson: number[] = [];
  const notes: string[] = [];
  for (const m of text.matchAll(/\$\s?(\d{1,4}(?:\.\d{2})?)/g)) {
    const value = Number(m[1]);
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 24).toLowerCase();
    if (/^\s*(per|a|\/)\s*couple/.test(after)) {
      notes.push(`$${value} per couple`);
      continue;
    }
    if (/^\s*(per|a|\/)\s*(class|month|session|course|series|\d+\s*weeks?)/.test(after) || /^\s*for\s*\d+\s*(classes|weeks|lessons)/.test(after)) {
      notes.push(`$${value} ${after.trim().split(/[.,;]/)[0]}`);
      perPerson.push(value);
      continue;
    }
    if (value > 0 && value < 500) perPerson.push(value);
    if (/^\s*(pp|p\.p\.)?\s*(don\b|donation)/.test(after)) notes.push('Suggested donation');
  }
  const lower = text.toLowerCase();
  if (/first (class|lesson) (is )?free/.test(lower)) notes.push('First class free for new students');
  if (/(free|complimentary) [a-z -]{0,25}lesson/.test(lower)) notes.push('Free lesson included');
  if (/discounts? for members|members? (pay less|discount|save)/.test(lower)) notes.push('Members pay less');
  if (/\b(at the door|cash only)\b/.test(lower)) notes.push('Pay at the door');
  const unique = [...new Set(notes)];
  if (perPerson.length) {
    const min = Math.min(...perPerson);
    const max = Math.max(...perPerson);
    return { price: min, priceMax: max > min ? max : undefined, notes: unique };
  }
  const free = /\b(free admission|admission (is )?free|no charge|no cover|free event|free dance|free social)\b|(^|[.!]\s*)free[.!]?\s*$|(^|[.!]\s*)free[.!]/i.test(text);
  return { isFree: free || undefined, notes: unique };
}
