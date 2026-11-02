/** Share links for events and directory pages (prefilled WhatsApp, Facebook, X, email and text message). */

export interface ShareLinkInput {
  title: string;
  url: string;
  /** Multi-line text that ends with the page address. */
  blurb: string;
  /** One line without the address (for X). */
  short: string;
}

/** The blurb without its last line when that line is the page address (the share menu adds the link itself). */
export function blurbWithoutUrl(blurb: string, url: string): string {
  const lines = blurb.split('\n');
  return lines.at(-1)?.trim() === url ? lines.slice(0, -1).join('\n') : blurb;
}

export function shareLinks(i: ShareLinkInput) {
  const enc = encodeURIComponent;
  const withUrl = i.blurb.includes(i.url) ? i.blurb : `${i.blurb}\n${i.url}`;
  return {
    whatsapp: `https://wa.me/?text=${enc(withUrl)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(i.url)}`,
    x: `https://x.com/intent/tweet?text=${enc(i.short)}&url=${enc(i.url)}`,
    email: `mailto:?subject=${enc(i.title)}&body=${enc(`${withUrl}\n\nShared from Long Island Dance Events`)}`,
    sms: `sms:?&body=${enc(withUrl)}`,
  };
}
