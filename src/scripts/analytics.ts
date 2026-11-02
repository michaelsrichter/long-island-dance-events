/**
 * Analytics and telemetry.
 *
 * 1. First-party, cookieless telemetry (always on): anonymous counts and Core Web Vitals are
 *    batched and sent with navigator.sendBeacon to /api/telemetry, which records them as
 *    OpenTelemetry metrics and custom events in Azure Monitor (Application Insights).
 * 2. Google Analytics 4 and Microsoft Clarity (optional): loaded only after consent
 *    (or in "opt-out" mode, until the visitor declines). Global Privacy Control is honored.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { pageTypeOf } from '../lib/page-type';

type Props = Record<string, string | number | boolean | undefined>;
type Consent = 'granted' | 'denied';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] };
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

const html = document.documentElement;
const cfg = {
  ga: html.dataset.gaId ?? '',
  clarity: html.dataset.clarityId ?? '',
  mode: html.dataset.consentMode === 'opt-out' ? 'opt-out' : 'opt-in',
  endpoint: html.dataset.telemetry ?? '/api/telemetry',
  release: html.dataset.release ?? 'local',
  pageType: html.dataset.pageType ?? 'page',
  eventSlug: html.dataset.eventSlug ?? '',
  entity: html.dataset.entity ?? '',
  town: html.dataset.town ?? '',
  category: html.dataset.eventCategory ?? '',
};
const CONSENT_KEY = 'site-analytics-consent';
const GA_EVENTS = new Set([
  'select_event',
  'view_event',
  'add_to_calendar',
  'share',
  'get_directions',
  'outbound_click',
  'click_hotline',
  'click_email',
  'newsletter_click',
  'filter_events',
  'view_calendar_month',
  'show_more',
  'theme_change',
  'faq_open',
  'empty_state',
  'search',
  'select_person',
  'report_problem',
  'sign_in_start',
]);

let gaLoaded = false;
let clarityLoaded = false;

/* ---------------- consent ---------------- */

function storedConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export function consentGranted(): boolean {
  if (navigator.globalPrivacyControl === true) return false;
  const c = storedConsent();
  if (c) return c === 'granted';
  return cfg.mode === 'opt-out';
}

function loadScript(src: string) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function loadGA() {
  if (gaLoaded || !cfg.ga) return;
  gaLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag requires the Arguments object, not an array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });
  window.gtag('js', new Date());
  window.gtag('config', cfg.ga, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_type: cfg.pageType,
    release: cfg.release,
  });
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.ga)}`);
}

function loadClarity() {
  if (clarityLoaded || !cfg.clarity) return;
  clarityLoaded = true;
  const c = function clarity() {
    // eslint-disable-next-line prefer-rest-params
    (c.q = c.q || []).push(arguments);
  } as NonNullable<Window['clarity']>;
  window.clarity = window.clarity || c;
  loadScript(`https://www.clarity.ms/tag/${encodeURIComponent(cfg.clarity)}`);
  window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
  window.clarity('set', 'page_type', cfg.pageType);
  if (cfg.eventSlug) window.clarity('set', 'event_slug', cfg.eventSlug);
}

function removeAnalyticsCookies() {
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0]!.trim())) {
    if (/^(_ga|_gid|_gat|_clck|_clsk|CLID|ANONCHK|MR|MUID|SM)/.test(name)) {
      for (const domain of ['', `; domain=${location.hostname}`, `; domain=.${location.hostname.replace(/^www\./, '')}`]) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
      }
    }
  }
}

export function setConsent(value: Consent) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* storage unavailable: choice applies to this page only */
  }
  if (value === 'granted') {
    loadGA();
    loadClarity();
  } else {
    window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
    window.clarity?.('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' });
    window.clarity?.('consent', false);
    removeAnalyticsCookies();
  }
  queue({ name: 'consent_update', props: { value, mode: cfg.mode } });
}

/* ---------------- first-party OpenTelemetry beacon ---------------- */

interface Item {
  name: string;
  props?: Props;
  value?: number;
}
const buffer: Item[] = [];
let flushTimer: number | undefined;

function clean(props: Props = {}): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === '') continue;
    // Only plain characters pass the server's check, so swap anything else for a space.
    out[k] = typeof v === 'string' ? v.replace(/[^\w\-.,:/ #()&']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) : v;
  }
  return out;
}

function queue(item: Item) {
  buffer.push({ ...item, props: clean(item.props) });
  if (buffer.length >= 20) flush();
  else {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, 4000);
  }
}

function flush() {
  window.clearTimeout(flushTimer);
  if (!buffer.length || !cfg.endpoint) return;
  const payload = JSON.stringify({
    v: 1,
    release: cfg.release,
    page: location.pathname.slice(0, 200),
    pageType: cfg.pageType,
    items: buffer.splice(0, 25),
  });
  const blob = new Blob([payload], { type: 'application/json' });
  if (!navigator.sendBeacon?.(cfg.endpoint, blob)) {
    void fetch(cfg.endpoint, { method: 'POST', body: payload, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  }
}

addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
addEventListener('pagehide', flush);

/* ---------------- public API ---------------- */

export function track(name: string, props: Props = {}) {
  const p = clean({ page_type: cfg.pageType, event_slug: cfg.eventSlug || undefined, entity: cfg.entity || undefined, ...props });
  queue({ name, props: p });
  if (consentGranted()) {
    if (gaLoaded && GA_EVENTS.has(name)) window.gtag?.('event', name, p);
    if (clarityLoaded) window.clarity?.('event', name);
  }
}

/* ---------------- wiring ---------------- */

// Declarative click tracking: <a data-track="get_directions" data-track-method="google">
document.addEventListener('click', (e) => {
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-track]');
  if (!el) return;
  track(el.dataset.track!, {
    method: el.dataset.trackMethod,
    location: el.dataset.trackLocation ?? el.closest<HTMLElement>('[data-track-location]')?.dataset.trackLocation,
    target: el.dataset.trackTarget,
  });
});

// FAQ opens (native <details>)
document.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement;
    if (d.matches?.('[data-faq]') && d.open) track('faq_open', { question: d.dataset.faq });
  },
  true,
);

function sendVital(m: Metric) {
  queue({ name: 'web_vital', value: Math.round(m.name === 'CLS' ? m.value * 1000 : m.value), props: { metric: m.name, rating: m.rating, nav: m.navigationType } });
}
onLCP(sendVital);
onINP(sendVital);
onCLS(sendVital);
onFCP(sendVital);
onTTFB(sendVital);

/* ---------------- page context (no personal data) ---------------- */

/** "phone", "tablet" or "desktop", from the screen size and whether it is a touch screen. */
function deviceClass(): string {
  const touch = matchMedia?.('(pointer: coarse)').matches;
  const short = Math.min(screen.width, screen.height);
  return touch && short < 600 ? 'phone' : touch && short < 1100 ? 'tablet' : 'desktop';
}

/** Where the visit came from: another site's name, "internal" (with the page type) or "direct". Never the full address. */
function referrer(): { ref: string; ref_page?: string } {
  try {
    if (!document.referrer) return { ref: 'direct' };
    const r = new URL(document.referrer);
    if (r.host === location.host) return { ref: 'internal', ref_page: pageTypeOf(r.pathname) };
    return { ref: r.protocol.startsWith('http') ? r.hostname.replace(/^www\./, '') : r.protocol.replace(':', '') };
  } catch {
    return { ref: 'unknown' };
  }
}

function campaign(): Props {
  const q = new URLSearchParams(location.search);
  return { utm_source: q.get('utm_source')?.slice(0, 50), utm_medium: q.get('utm_medium')?.slice(0, 50), utm_campaign: q.get('utm_campaign')?.slice(0, 50) };
}

const pageContext: Props = { entity: cfg.entity || undefined, town: cfg.town || undefined, category: cfg.category || undefined };

queue({ name: 'page_view', props: { page_type: cfg.pageType, device: deviceClass(), ...referrer(), ...campaign(), ...pageContext } });
if (cfg.eventSlug) track('view_event', { event_status: html.dataset.eventStatus, days_until: Number(html.dataset.daysUntil ?? '') || undefined, ...pageContext });

/* ---------------- searches (event list and directory search boxes) ---------------- */

let lastTerm = '';
function visibleResults(): number {
  return document.querySelectorAll('[data-upcoming-list] [data-event]:not([hidden]), [data-dir-item]:not([hidden])').length;
}
function sendSearch(input: HTMLInputElement, method: string) {
  const term = input.value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
  if (term.length < 2 || term === lastTerm) return;
  lastTerm = term;
  // Never send something that looks like an email address or a phone number.
  const safe = /@|\d{7,}|\d{3}[\s.-]\d{3,4}/.test(term) ? '(hidden)' : term;
  // Wait a moment so the list has finished filtering before counting what is left.
  window.setTimeout(() => track('search', { term: safe, results: visibleResults(), location: cfg.pageType, method }), 400);
}
let searchTimer: number | undefined;
document.addEventListener(
  'input',
  (e) => {
    const el = e.target as HTMLInputElement | null;
    if (!el?.matches?.('input[type="search"][name="q"]')) return;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => sendSearch(el, 'typed'), 1500);
  },
  true,
);
// Searches that arrive in the address (for example from the home page search box).
const urlSearch = new URLSearchParams(location.search).get('q');
if (urlSearch) {
  const box = document.querySelector<HTMLInputElement>('input[type="search"][name="q"]');
  if (box) window.setTimeout(() => sendSearch(box, 'link'), 1200);
}

/* ---------------- sign-in clicks and script errors ---------------- */

document.addEventListener('click', (e) => {
  const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="/.auth/login"]');
  if (a) track('sign_in_start', { location: a.closest<HTMLElement>('[data-track-location]')?.dataset.trackLocation ?? (a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : cfg.pageType) });
});

let errorsSent = 0;
function reportError(message: string, file?: string, line?: number) {
  if (errorsSent >= 5 || /ResizeObserver loop/i.test(message) || /^Script error\.?$/i.test(message)) return;
  // Only our own scripts (browser add-ons and other sites' scripts are not our bugs).
  if (file && !file.startsWith(location.origin)) return;
  errorsSent++;
  track('js_error', { message: message.slice(0, 100), source: file ? file.split('/').pop()?.split('?')[0] : 'unknown', line });
}
addEventListener('error', (e) => reportError(e.message || 'error', e.filename, e.lineno));
addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string } | string | undefined;
  reportError(`Unhandled: ${typeof r === 'string' ? r : r?.message ?? 'promise rejected'}`);
});

// Consent banner
const banner = document.querySelector<HTMLElement>('[data-consent]');
// While the banner shows, leave that much room under the page (and when scrolling to a field) so it never hides a button or form field.
const roomForBanner = () => document.documentElement.style.setProperty('--consent-space', banner && !banner.hidden ? `${banner.offsetHeight + 16}px` : '0px');
if (banner && 'ResizeObserver' in window) new ResizeObserver(roomForBanner).observe(banner);
const hasThirdParty = Boolean(cfg.ga || cfg.clarity);
if (hasThirdParty) {
  if (consentGranted()) {
    loadGA();
    loadClarity();
  }
  const gpc = navigator.globalPrivacyControl === true;
  if (banner && !gpc && storedConsent() === null) banner.hidden = false;
  banner?.querySelectorAll<HTMLButtonElement>('[data-consent-choice]').forEach((b) =>
    b.addEventListener('click', () => {
      setConsent(b.dataset.consentChoice as Consent);
      banner.hidden = true;
      roomForBanner();
    }),
  );
  roomForBanner();
}
document.querySelectorAll<HTMLButtonElement>('[data-consent-open]').forEach((b) => {
  if (!hasThirdParty) {
    b.hidden = true;
    return;
  }
  b.addEventListener('click', () => {
    if (!banner) return;
    banner.hidden = false;
    roomForBanner();
    banner.querySelector<HTMLButtonElement>('[data-consent-choice]')?.focus();
  });
});
