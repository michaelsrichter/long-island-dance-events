'use strict';
/**
 * Optional: open a GitHub issue for a private correction. Needs GITHUB_ISSUES_TOKEN (a fine-grained
 * token limited to "Issues: write" on this one repository). The issue has the page link and the
 * suggested fix only, never the person's name or account id.
 */
const REPO = process.env.GITHUB_ISSUES_REPO || 'michaelsrichter/long-island-dance-events';
const SITE = (process.env.SITE_URL || 'https://longisland.dance').replace(/\/+$/, '');
const PATHS = { event: 'events', venue: 'venues', organizer: 'organizers', instructor: 'instructors', performer: 'performers', style: 'styles' };

function pageUrl(key) {
  const [type, id] = key.split(':');
  return type === 'event' ? `${SITE}/events/` : `${SITE}/${PATHS[type]}/${id}/`;
}

async function openCorrectionIssue({ key, text, date }, fetchImpl = fetch) {
  const token = process.env.GITHUB_ISSUES_TOKEN;
  if (!token) return '';
  const body = [`A visitor suggested a correction on the website.`, '', `- Page: \`${key}\` (${pageUrl(key)})`, ...(date ? [`- Date: ${date}`] : []), '', '> ' + text.replace(/\n/g, '\n> '), '', '_Sent from the "Suggest a correction" form. The visitor\'s account is not shown here; see the moderation page._'].join('\n');
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'long-island-dance-community' },
    body: JSON.stringify({ title: `Correction suggested for ${key}`, body, labels: ['correction', 'from-site'] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = await res.json();
  return data.html_url || '';
}

module.exports = { openCorrectionIssue, pageUrl };
