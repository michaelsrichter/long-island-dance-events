/**
 * Rules of the newsletter sign-up helper (scripts/newsletter-signup.ts): which forms count as a
 * newsletter sign-up, what may be typed into them, and when a person has to do it instead.
 * All form descriptions here are fictional.
 */
import { describe, expect, it } from 'vitest';
import { isSocialLink, judgeForm, newLines, planFields, platformOf } from '../../scripts/newsletter-signup';

type Field = { index: number; tag: string; type: string; key: string; required: boolean; visible: boolean };
const field = (index: number, type: string, key: string, required = false, visible = true, tag = 'input'): Field => ({ index, tag, type, key, required, visible });
const form = (text: string, fields: Field[], extra: Partial<{ action: string; context: string }> = {}) => ({
  text,
  action: extra.action ?? '',
  context: extra.context ?? '',
  fields,
  hasTextarea: fields.some((f) => f.tag === 'textarea' && f.visible),
  hasPassword: fields.some((f) => f.type === 'password'),
  emailIndex: fields.findIndex((f) => f.visible && (f.type === 'email' || /e-?mail/.test(f.key))),
});

describe('which forms are newsletter sign-ups', () => {
  it('accepts a plain newsletter box', () => {
    expect(judgeForm(form('Join our mailing list Subscribe', [field(0, 'email', 'email', true)]))).toBeUndefined();
    expect(judgeForm(form('Email Go', [field(0, 'email', 'email')], { action: 'https://example.us1.list-manage.com/subscribe/post' }))).toBeUndefined();
    expect(judgeForm(form('Name Email', [field(0, 'text', 'name'), field(1, 'email', 'email')]), 'https://pretend-venue.example/join-our-mailing-list/')).toBeUndefined();
    expect(judgeForm(form('Email', [field(0, 'email', 'email')], { context: 'Be the first to know about shows' }))).toBeUndefined();
  });
  it('rejects contact, login and other forms', () => {
    expect(judgeForm(form('Contact us Name Email Message Send', [field(0, 'email', 'email'), field(1, 'textarea', 'message', true, true, 'textarea')]))).toMatch(/contact form/);
    expect(judgeForm(form('Log in Email Password', [field(0, 'email', 'email'), field(1, 'password', 'password')]))).toMatch(/login/);
    expect(judgeForm(form('Book a table Email', [field(0, 'email', 'email')]))).toBeDefined();
    expect(judgeForm(form('Name Email', [field(0, 'email', 'email')]))).toMatch(/not a newsletter/);
    expect(judgeForm(form('Subscribe', [field(0, 'email', 'email', true, false)]))).toMatch(/no visible email/);
  });
});

describe('what may be typed into a sign-up form', () => {
  it('fills only a project name and a central Long Island ZIP', () => {
    const f = form('Newsletter', [field(0, 'email', 'email', true), field(1, 'text', 'fname first name', true), field(2, 'text', 'lname last name'), field(3, 'text', 'zip code', true)]);
    expect(planFields(f)).toEqual([
      { index: 1, value: 'Long Island' },
      { index: 2, value: 'Dance Events' },
      { index: 3, value: '11747' },
    ]);
  });
  it('ticks a required email-consent box', () => {
    const f = form('Newsletter', [field(0, 'email', 'email', true), field(1, 'checkbox', 'i agree to receive emails', true)]);
    expect(planFields(f)).toEqual([{ index: 1, check: true }]);
  });
  it('leaves optional personal fields empty and refuses required ones', () => {
    expect(planFields(form('Newsletter', [field(0, 'email', 'email', true), field(1, 'tel', 'phone')]))).toEqual([]);
    expect(planFields(form('Newsletter', [field(0, 'email', 'email', true), field(1, 'tel', 'phone', true)]))[0]).toHaveProperty('skip');
    expect(planFields(form('Newsletter', [field(0, 'email', 'email', true), field(1, 'text', 'birthday', true)]))[0]).toHaveProperty('skip');
    expect(planFields(form('Newsletter', [field(0, 'email', 'email', true), field(1, 'text', 'street address', true)]))[0]).toHaveProperty('skip');
    expect(planFields(form('Newsletter', [field(0, 'email', 'email', true), field(1, 'checkbox', 'i am over 21 and want vip perks', true)]))[0]).toHaveProperty('skip');
  });
});

describe('helpers', () => {
  it('names the mail service behind a form', () => {
    expect(platformOf('https://pretend.us5.list-manage.com/subscribe/post')).toBe('mailchimp');
    expect(platformOf('https://lp.constantcontactpages.com/sl/abc')).toBe('constant-contact');
    expect(platformOf('https://pretend-venue.example/')).toBeUndefined();
    // Whole host names only: a look-alike or a longer name is not the mail service.
    expect(platformOf('https://pretend.ck.page/join')).toBe('convertkit');
    expect(platformOf('https://toolkit.com/signup')).toBeUndefined();
    expect(platformOf('https://list-manage.com.pretend.example/')).toBeUndefined();
    expect(platformOf('<script src="https://static.parastorage.com/x.js"></script>')).toBe('wix');
    expect(isSocialLink('https://www.facebook.com/pretend')).toBe(true);
    expect(isSocialLink('https://x.com/pretend')).toBe(true);
    expect(isSocialLink('https://dropbox.com/s/flyer.pdf')).toBe(false);
    expect(isSocialLink('not a link')).toBe(false);
  });
  it('reads only the lines that appeared after submitting', () => {
    expect(newLines('Thank you for a great summer\nEmail', 'Thank you for a great summer\nEmail\nAlmost finished, please check your email')).toBe('Almost finished, please check your email');
  });
});
