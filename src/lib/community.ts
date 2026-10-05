/**
 * Community features (likes, comments, photos): shared settings and helpers.
 * Sign-in is Microsoft Entra External ID through Azure Static Web Apps (provider "extid").
 * Public data is read straight from Blob Storage: <blobBase>/community/<type>/<id>.json.
 */
import config from '../data/community.json';

export type PageType = 'event' | 'venue' | 'organizer' | 'instructor' | 'performer' | 'style';

/**
 * signInServiceDays: how long the sign-in service remembers a visitor after the browser closes. 0 = until the
 * browser closes (External ID's default). Set it to 90 after turning on Conditional Access
 * "Persistent browser session: Always persistent" (docs/deployment.md), so returning the next day works too.
 */
export const COMMUNITY = config as { blobBase: string; loginProvider: string; photosEnabled: boolean; signInServiceDays: number };

export function pageKey(type: PageType, id: string): string {
  return `${type}:${id}`;
}

/** Public JSON with likes, approved comments and approved photos for one page. */
export function readModelUrl(key: string): string {
  const [type, id] = key.split(':');
  return `${COMMUNITY.blobBase}/community/${type}/${id}.json`;
}

/** Sign-in link: after signing in, the visitor passes the one-time welcome step at /account/ and returns to `nextPath`. */
export function loginHref(site: URL, nextPath: string): string {
  const back = new URL(`/account/?next=${encodeURIComponent(nextPath)}`, site).toString();
  return `/.auth/login/${COMMUNITY.loginProvider}?post_login_redirect_uri=${encodeURIComponent(back)}`;
}

export function logoutHref(returnTo: string): string {
  return `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`;
}
