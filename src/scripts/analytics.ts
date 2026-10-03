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
    out[k] = typeof v === 'string' ? v.slice(0, 100) : v;
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
  const p = clean({ page_type: cfg.pageType, event_slug: cfg.eventSlug || undefined, ...props });
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

queue({ name: 'page_view', props: { page_type: cfg.pageType } });
if (cfg.eventSlug) track('view_event', { event_status: html.dataset.eventStatus, days_until: Number(html.dataset.daysUntil ?? '') || undefined });

// Consent banner
const banner = document.querySelector<HTMLElement>('[data-consent]');
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
    }),
  );
}
document.querySelectorAll<HTMLButtonElement>('[data-consent-open]').forEach((b) => {
  if (!hasThirdParty) {
    b.hidden = true;
    return;
  }
  b.addEventListener('click', () => {
    if (!banner) return;
    banner.hidden = false;
    banner.querySelector<HTMLButtonElement>('[data-consent-choice]')?.focus();
  });
});
