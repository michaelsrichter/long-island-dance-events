/**
 * Host checks for the newsletter scripts (decision P44). A host matches a domain only as a whole host
 * name: "news.list-manage.com" is on list-manage.com, but "list-manage.com.example.net" and
 * "toolkit.com" are not. Used by scripts/newsletter-inbox.mjs (which emails and confirmation links
 * to trust) and scripts/newsletter-signup.ts.
 */

/** "news.list-manage.com" is on list-manage.com; "toolkit.com" is not on kit.com. */
export const onDomain = (host: string, domain: string): boolean => {
  const h = host.toLowerCase().replace(/\.$/, '');
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
};

/** Host name of a web link ("" when it is not an http(s) address). */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** "www.sample-pub.example" -> "sample-pub.example" (the last two labels). */
export const siteDomain = (host: string): string => host.toLowerCase().split('.').slice(-2).join('.');

export interface MailService {
  name: string;
  /** Domains its emails are sent from. */
  from: string[];
  /** Domains its confirmation links use. */
  links: string[];
}

/** Mail services that send on a site's behalf (checked against real confirmation emails, Oct 2026). */
export const SERVICES: MailService[] = [
  { name: 'mailchimp', from: ['mcsv.net', 'mcdlv.net', 'mailchimpapp.net', 'list-manage.com', 'mailchimp.com'], links: ['list-manage.com', 'mailchi.mp', 'mailchimp.com'] },
  { name: 'constant-contact', from: ['ccsend.com', 'constantcontact.com', 'ctctmail.com'], links: ['constantcontact.com', 'ccsend.com', 'rs6.net', 'ctctcdn.com'] },
  { name: 'klaviyo', from: ['klaviyo.com', 'klaviyomail.com'], links: ['klaviyo.com', 'klaviyomail.com', 'klclick.com'] },
  { name: 'mailerlite', from: ['mailerlite.com', 'mlsend.com', 'mlsend2.com'], links: ['mailerlite.com', 'mlsend.com', 'mlsend2.com'] },
  { name: 'brevo', from: ['sendinblue.com', 'brevo.com', 'sibmail.com'], links: ['sendinblue.com', 'brevo.com', 'sibforms.com', 'sp1-brevo.net'] },
  { name: 'squarespace', from: ['squarespace.com', 'squarespace-mail.com', 'campaign-preferences.com'], links: ['squarespace.com', 'squarespace-mail.com', 'campaign-preferences.com'] },
  { name: 'wix', from: ['wix.com', 'wixemails.com'], links: ['wix.com', 'wixsite.com', 'wixapps.net', 'editorx.io'] },
  { name: 'aweber', from: ['aweber.com'], links: ['aweber.com'] },
  { name: 'emma', from: ['e2ma.net', 'myemma.com'], links: ['e2ma.net', 'myemma.com'] },
  { name: 'convertkit', from: ['convertkit.com', 'convertkit-mail.com', 'convertkit-mail2.com', 'kit.com'], links: ['convertkit.com', 'ck.page', 'kit.com'] },
  { name: 'flodesk', from: ['flodesk.com'], links: ['flodesk.com'] },
  { name: 'substack', from: ['substack.com'], links: ['substack.com'] },
  { name: 'beehiiv', from: ['beehiiv.com'], links: ['beehiiv.com'] },
];

/** The mail service an email came from, by the sender's domain ("x@mailchimp.example.net" is none). */
export const serviceForSender = (senderDomain: string): MailService | undefined => SERVICES.find((s) => s.from.some((d) => onDomain(senderDomain, d)));

/**
 * May a confirmation link on this host be opened? Only on the sign-up's own site, or on the mail
 * service that sent the email (or that the sign-up form used).
 */
export function confirmHostOk(host: string, opts: { site?: string | undefined; service?: MailService | undefined; platform?: string | undefined }): boolean {
  if (!host) return false;
  const site = opts.site ? siteDomain(opts.site) : '';
  if (site && onDomain(host, site)) return true;
  return SERVICES.some((v) => (v === opts.service || v.name === opts.platform) && v.links.some((d) => onDomain(host, d)));
}

export type OpenResult = { ok: true; res: Response; url: string } | { ok: false; url: string; reason: 'host' | 'robots' | 'too-many-redirects' };

/**
 * Open a link without trusting where it forwards: redirects are not followed automatically; each new
 * address must pass the same host check and robots.txt before it is opened.
 */
export async function openChecked(
  url: string,
  check: { hostOk: (host: string) => boolean; robotsOk: (url: string) => Promise<boolean>; headers?: Record<string, string>; fetchImpl?: typeof fetch; maxHops?: number },
): Promise<OpenResult> {
  const doFetch = check.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop <= (check.maxHops ?? 5); hop++) {
    if (!check.hostOk(hostOf(current))) return { ok: false, url: current, reason: 'host' };
    if (!(await check.robotsOk(current))) return { ok: false, url: current, reason: 'robots' };
    const res = await doFetch(current, { headers: check.headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return { ok: true, res, url: current };
    current = new URL(location, current).href;
  }
  return { ok: false, url: current, reason: 'too-many-redirects' };
}
