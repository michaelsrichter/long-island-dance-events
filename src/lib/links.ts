/** Turns the website/social fields shared by people and organizers into an ordered list of links. */

export type LinkKind = 'website' | 'facebook' | 'instagram' | 'youtube' | 'link';

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
  moreLinks?: { label: string; url: string }[] | undefined;
}

/** Website first, then social pages, then any extra labelled links. Duplicate URLs are dropped. */
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
  for (const l of f.moreLinks ?? []) add('link', l.label, l.url);
  return out;
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
