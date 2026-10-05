/** Turns the website/social fields shared by people and organizers into an ordered list of links. */

export type LinkKind = 'website' | 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'x' | 'spotify' | 'bandcamp' | 'link';

export interface ExternalLink {
  kind: LinkKind;
  /** Short visible label, e.g. "Website" or "Meetup group". */
  label: string;
  url: string;
}

export interface LinkFields {
  website?: string | undefined;
  facebookUrl?: string | undefined;
  instagramUrl?: string | undefined;
  youtubeUrl?: string | undefined;
  tiktokUrl?: string | undefined;
  xUrl?: string | undefined;
  spotifyUrl?: string | undefined;
  bandcampUrl?: string | undefined;
  moreLinks?: { label: string; url: string }[] | undefined;
}

/** Website first, then social and music pages, then any extra labelled links. Duplicate URLs are dropped. */
export function linksOf(f: LinkFields): ExternalLink[] {
  const out: ExternalLink[] = [];
  const seen = new Set<string>();
  const add = (kind: LinkKind, label: string, url: string | undefined) => {
    if (!url) return;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, label, url });
  };
  add('website', 'Website', f.website);
  add('facebook', 'Facebook', f.facebookUrl);
  add('instagram', 'Instagram', f.instagramUrl);
  add('youtube', 'YouTube', f.youtubeUrl);
  add('tiktok', 'TikTok', f.tiktokUrl);
  add('x', 'X', f.xUrl);
  add('spotify', 'Spotify', f.spotifyUrl);
  add('bandcamp', 'Bandcamp', f.bandcampUrl);
  for (const l of f.moreLinks ?? []) add('link', l.label, l.url);
  return out;
}

/** Icon name for a link kind (components/Icon.astro). */
export function linkIcon(k: LinkKind): 'link' | 'external' | 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'xsocial' | 'spotify' | 'bandcamp' {
  if (k === 'website') return 'link';
  if (k === 'link') return 'external';
  if (k === 'x') return 'xsocial';
  return k;
}

/** "tel:" link for a US phone number written for people, e.g. "(631) 476-3707" -> "tel:+16314763707". */
export function telHref(phone: string): string {
  return `tel:+1${phone.replace(/[^0-9]/g, '').replace(/^1(?=\d{10}$)/, '')}`;
}

/** The single best link for a name mention: the website, else the first social page. */
export function primaryLink(f: LinkFields): ExternalLink | undefined {
  return linksOf(f)[0];
}

/** "https://www.triplestepswing.com/about" -> "triplestepswing.com". */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
