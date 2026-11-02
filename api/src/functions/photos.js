'use strict';
/**
 * POST /api/photos (multipart form): key, file, caption, alt, own, people, noKids, date?
 * 18+ only. The photo is cleaned (no EXIF/GPS, three WebP sizes, original discarded), checked by AI,
 * stored privately, and ALWAYS waits for a human before it is shown.
 */
const { serverEvent } = require('../telemetry-setup');
const { app } = require('@azure/functions');
const { json, error, sameOrigin, cleanText } = require('../lib/http');
const { table, container, TABLES, CONTAINERS, revTime, newId } = require('../lib/store');
const { requireMember } = require('../lib/users');
const { allow } = require('../lib/limits');
const { pageExists } = require('../lib/pages');
const moderate = require('../lib/moderate');
const { processPhoto, MAX_UPLOAD_BYTES } = require('../lib/images');
const { photoPaths } = require('../lib/readmodel');
const { audit } = require('../lib/audit');
const { alertAdmins } = require('../lib/notify');

const yes = (v) => v === 'yes' || v === 'true' || v === 'on';

app.http('photos', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'photos',
  handler: async (request, context) => {
    if (!sameOrigin(request)) return error(403, 'origin', 'Not allowed.');
    const len = Number(request.headers.get('content-length') || '0');
    if (len > MAX_UPLOAD_BYTES + 64 * 1024) return error(413, 'too_large', 'That photo is too big. Please use one under 10 MB.');
    if (!/^multipart\/form-data\b/i.test(request.headers.get('content-type') || '')) return error(415, 'bad_type', 'Expected a form upload.');
    const m = await requireMember(request, { needAdult: true });
    if (m.response) return m.response;
    if (!m.user.photoTermsAt) return error(428, 'photo_terms', 'Please agree to the photo rules on your account page first.');

    let form;
    try {
      form = await request.formData();
    } catch {
      return error(400, 'bad_form', 'Could not read the upload.');
    }
    const key = String(form.get('key') || '');
    if (!(await pageExists(request, key))) return error(400, 'bad_request', 'Unknown page.');
    if (!yes(form.get('own')) || !yes(form.get('people')) || !yes(form.get('noKids'))) {
      return error(400, 'consent', 'Please tick all three boxes to confirm the photo follows our rules.');
    }
    const caption = cleanText(String(form.get('caption') || ''), 200);
    const alt = cleanText(String(form.get('alt') || ''), 200);
    if (alt.length < 5) return error(400, 'alt', 'Please describe the photo in a few words for people who cannot see it.');
    const dateRaw = String(form.get('date') || '');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : '';
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return error(400, 'empty', 'Please choose a photo.');
    if (!(await allow(m.principal.userId, 'photo'))) return error(429, 'slow_down', 'You have shared a lot of photos today. Please try again tomorrow.');

    const processed = await processPhoto(Buffer.from(await file.arrayBuffer()));
    if (!processed.ok) return error(processed.code === 'unavailable' ? 503 : 400, processed.code, processed.message);

    const medium = processed.variants.find((v) => v.px === 1024) || processed.variants[0];
    const [imageScores, textScores] = await Promise.all([moderate.analyzeImage(medium.buffer), moderate.analyzeText(`${caption}\n${alt}`.trim())]);
    const scores = imageScores && textScores ? Object.fromEntries(moderate.CATEGORIES.map((c) => [c, Math.max(imageScores[c] || 0, textScores[c] || 0)])) : imageScores;
    const verdict = moderate.decide({ kind: 'photo', scores, hits: moderate.ruleHits(caption) });
    const photoId = newId();
    const rk = `${revTime()}_${photoId}`;
    const at = new Date().toISOString();
    const status = verdict.decision === 'reject' ? 'rejected' : 'pending';

    if (status === 'pending') {
      const paths = photoPaths(key, photoId);
      const byPx = { 480: paths.s, 1024: paths.m, 2048: paths.l };
      for (const v of processed.variants) await container(CONTAINERS.pending).upload(byPx[v.px], v.buffer, 'image/webp', 'no-store');
    }
    await table(TABLES.photos).create({
      partitionKey: key,
      rowKey: rk,
      photoId,
      userId: m.principal.userId,
      displayName: m.user.displayName,
      caption,
      alt,
      occurrenceDate: date,
      width: processed.width,
      height: processed.height,
      status,
      reason: verdict.reason,
      ai: scores ? JSON.stringify(scores) : '',
      consent: 'own,people,noKids',
      flagCount: 0,
      createdAt: at,
    });
    await table(TABLES.userItems).upsert({ partitionKey: m.principal.userId, rowKey: `photo~${key}~${rk}`, at });
    if (status === 'pending') {
      await table(TABLES.queue).upsert({ partitionKey: 'pending', rowKey: `p~${key}~${rk}`, itemType: 'photo', key, itemKey: rk, reason: verdict.reason, ai: scores ? JSON.stringify(scores) : '', at });
    }
    await audit({ actor: 'ai', action: verdict.decision, targetType: 'photo', targetId: rk, key, reason: verdict.reason, scores, after: status });
    if (status === 'pending') await alertAdmins('photo', { log: context?.warn?.bind(context) });
    await serverEvent('community_photo', { type: key.split(':')[0], result: status === 'pending' ? 'queued' : status });
    return json(status === 'rejected' ? 422 : 200, {
      status,
      message: status === 'rejected' ? moderate.MESSAGES.reject : 'Thanks! A volunteer will look at your photo before it appears (usually within a day or two).',
    });
  },
});
