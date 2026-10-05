/**
 * Tests for the host checks the newsletter scripts use (scripts/lib/mail-hosts.ts). All addresses
 * are fictional; no network is used.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../ingest/lib/registry';
import { confirmHostOk, hostOf, onDomain, openChecked, serviceForSender } from '../../scripts/lib/mail-hosts';

describe('newsletter host checks', () => {
  it('matches whole host names only', () => {
    expect(onDomain('us5.list-manage.com', 'list-manage.com')).toBe(true);
    expect(onDomain('list-manage.com', 'list-manage.com')).toBe(true);
    expect(onDomain('list-manage.com.attacker.example', 'list-manage.com')).toBe(false);
    expect(onDomain('toolkit.com', 'kit.com')).toBe(false);
    expect(hostOf('javascript:alert(1)')).toBe('');
  });

  it('knows a mail service only by its real sending domain', () => {
    expect(serviceForSender('mcsv.net')?.name).toBe('mailchimp');
    expect(serviceForSender('mail182.atl11.mcsv.net')?.name).toBe('mailchimp');
    expect(serviceForSender('campaign-preferences.com')?.name).toBe('squarespace');
    // "x@mailchimp.attacker.example" is not Mailchimp.
    expect(serviceForSender('mailchimp.attacker.example')).toBeUndefined();
  });

  it('opens confirmation links only on the site or the mail service that sent the email', () => {
    const mailchimp = serviceForSender('mcsv.net');
    const opts = { site: 'www.sample-pub.example', service: mailchimp };
    expect(confirmHostOk('sample-pub.example', opts)).toBe(true);
    expect(confirmHostOk('news.sample-pub.example', opts)).toBe(true);
    expect(confirmHostOk('pretend.us5.list-manage.com', opts)).toBe(true);
    expect(confirmHostOk('list-manage.com.attacker.example', opts)).toBe(false);
    expect(confirmHostOk('sample-pub.example.attacker.example', opts)).toBe(false);
    // Another mail service's host is not trusted for this email.
    expect(confirmHostOk('pretend.ck.page', opts)).toBe(false);
    expect(confirmHostOk('g3j1.engage.squarespace-mail.com', { site: 'sample-pub.example', platform: 'squarespace' })).toBe(true);
  });

  it('checks every redirect before following it', async () => {
    const opened: string[] = [];
    const responses: Record<string, Response> = {
      'https://pretend.us5.list-manage.com/subscribe/confirm?u=1': new Response(null, { status: 302, headers: { location: 'https://sample-pub.example/thanks' } }),
      'https://sample-pub.example/thanks': new Response('Thanks, you are subscribed', { status: 200 }),
      'https://pretend.us5.list-manage.com/subscribe/confirm?u=2': new Response(null, { status: 302, headers: { location: 'https://list-manage.com.attacker.example/x' } }),
    };
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      opened.push(url);
      return responses[url] ?? new Response('not found', { status: 404 });
    }) as typeof fetch;
    const hostOk = (h: string) => confirmHostOk(h, { site: 'sample-pub.example', service: serviceForSender('mcsv.net') });
    const robotsOk = async () => true;

    const good = await openChecked('https://pretend.us5.list-manage.com/subscribe/confirm?u=1', { hostOk, robotsOk, fetchImpl });
    expect(good.ok && good.url).toBe('https://sample-pub.example/thanks');

    const bad = await openChecked('https://pretend.us5.list-manage.com/subscribe/confirm?u=2', { hostOk, robotsOk, fetchImpl });
    expect(bad).toMatchObject({ ok: false, reason: 'host', url: 'https://list-manage.com.attacker.example/x' });
    expect(opened).not.toContain('https://list-manage.com.attacker.example/x');

    const blocked = await openChecked('https://sample-pub.example/thanks', { hostOk, robotsOk: async () => false, fetchImpl });
    expect(blocked).toMatchObject({ ok: false, reason: 'robots' });
  });

  it('is what scripts/newsletter-inbox.mjs uses (no host patterns of its own, no automatic redirects)', () => {
    const code = readFileSync(join(ROOT, 'scripts', 'newsletter-inbox.mjs'), 'utf8');
    expect(code).toMatch(/from '\.\/lib\/mail-hosts\.ts'/);
    expect(code).toMatch(/openChecked\(/);
    expect(code).not.toMatch(/redirect:\s*'follow'/);
    expect(code).not.toMatch(/\/[^/\n]*\\\.(?:com|net|mp|page)[^/\n]*\/i/);
  });
});
