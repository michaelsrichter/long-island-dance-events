'use strict';
/**
 * Moderation: Azure AI Content Safety checks plus simple rules, and one pure decision function.
 *
 *   publish  -> all AI scores 0 and no rule hits (text only)
 *   queue    -> AI unsure (score 2), rule hits (links, phone numbers, emails...), every photo,
 *               every private correction, or AI unavailable
 *   reject   -> any AI score 4 or more, or a word on the deny list
 *
 * Content Safety reports four categories (Hate, Sexual, SelfHarm, Violence) as 0, 2, 4 or 6.
 * It cannot detect child sexual abuse material, so every photo also needs a human.
 */
const API_VERSION = '2024-09-01';
const CATEGORIES = ['Hate', 'Sexual', 'SelfHarm', 'Violence'];

function config() {
  const endpoint = (process.env.CONTENT_SAFETY_ENDPOINT || '').replace(/\/+$/, '');
  const key = process.env.CONTENT_SAFETY_KEY || '';
  return endpoint && key ? { endpoint, key } : null;
}

async function call(path, payload, fetchImpl = fetch) {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await fetchImpl(`${cfg.endpoint}/contentsafety/${path}?api-version=${API_VERSION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': cfg.key },
      body: JSON.stringify({ ...payload, outputType: 'FourSeverityLevels' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const scores = {};
    for (const c of data.categoriesAnalysis || []) if (CATEGORIES.includes(c.category)) scores[c.category] = Number(c.severity) || 0;
    return scores;
  } catch {
    return null;
  }
}

/** Returns scores like { Hate: 0, Sexual: 0, SelfHarm: 0, Violence: 2 }, or null if the AI check is unavailable. */
const analyzeText = (text, fetchImpl) => (text ? call('text:analyze', { text: text.slice(0, 10000) }, fetchImpl) : Promise.resolve({ Hate: 0, Sexual: 0, SelfHarm: 0, Violence: 0 }));
const analyzeImage = (buffer, fetchImpl) => call('image:analyze', { image: { content: Buffer.from(buffer).toString('base64') } }, fetchImpl);

function denyWords() {
  return (process.env.MODERATION_DENY_WORDS || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

/** Rule checks the AI does not cover: personal details, links, spam patterns, local deny list. */
function ruleHits(text) {
  const hits = [];
  if (!text) return hits;
  const lower = text.toLowerCase();
  const words = denyWords();
  if (words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i').test(lower))) hits.push('deny_word');
  if (/\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|info|biz|ly|me|app|dance|gg|xyz)\b/i.test(text)) hits.push('link');
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) hits.push('email');
  if (/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text)) hits.push('phone');
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) hits.push('shouting');
  if (/(.)\1{9,}/.test(text)) hits.push('repeated');
  return hits;
}

function maxScore(scores) {
  return scores ? Math.max(0, ...CATEGORIES.map((c) => Number(scores[c]) || 0)) : null;
}

/**
 * kind: 'comment' | 'correction' | 'photo' | 'name'
 * Returns { decision: 'publish' | 'queue' | 'reject', reason }.
 */
function decide({ kind, scores, hits = [] }) {
  const max = maxScore(scores);
  if (hits.includes('deny_word')) return { decision: 'reject', reason: 'blocked_word' };
  if (max !== null && max >= 4) return { decision: 'reject', reason: 'ai_high' };
  if (kind === 'name') {
    const personal = hits.find((h) => h === 'link' || h === 'email' || h === 'phone');
    if (personal) return { decision: 'reject', reason: `rule_${personal}` };
    if (max === null) return { decision: 'publish', reason: 'ai_unavailable' };
    if (max >= 2) return { decision: 'reject', reason: 'ai_gray' };
    return { decision: 'publish', reason: 'clean' };
  }
  if (kind === 'photo') return { decision: 'queue', reason: max === null ? 'ai_unavailable' : 'photo' };
  if (kind === 'correction') return { decision: 'queue', reason: 'correction' };
  if (max === null) return { decision: 'queue', reason: 'ai_unavailable' };
  if (max >= 2) return { decision: 'queue', reason: 'ai_gray' };
  if (hits.length) return { decision: 'queue', reason: `rule_${hits[0]}` };
  return { decision: 'publish', reason: 'clean' };
}

/** What the person sees after posting. */
const MESSAGES = {
  publish: 'Thanks! Your post is live.',
  queue: 'Thanks! A volunteer will check your post before it appears.',
  reject: 'Sorry, this post breaks our community rules, so it was not posted. You can edit it and try again.',
};

module.exports = { analyzeText, analyzeImage, ruleHits, decide, maxScore, MESSAGES, CATEGORIES, API_VERSION };
