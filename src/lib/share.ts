/** Plain-text summaries and share links for events. */

export interface ShareInput {
  title: string;
  dateLabel: string; // "Tuesday, October 6, 2026"
  timeLabel?: string | undefined; // "7:30 PM"
  venueName?: string | undefined;
  town?: string | undefined;
  url: string;
  status?: string | undefined;
}

/** One-line summary used for copy, SMS, email and native share. */
export function shareText(i: ShareInput): string {
  const prefix = i.status === 'cancelled' ? 'CANCELLED: ' : i.status === 'postponed' ? 'POSTPONED: ' : '';
  const when = i.timeLabel ? `${i.dateLabel} at ${i.timeLabel}` : `${i.dateLabel} (time to be announced)`;
  const where = [i.venueName, i.town].filter(Boolean).join(', ');
  return `${prefix}${i.title}, ${when}${where ? `, ${where}` : ''}. ${i.url}`;
}

/** Multi-line summary for "Copy event details" (for posting manually to Instagram etc.). */
export function detailText(i: ShareInput & { lesson?: string | undefined; admission?: string | undefined; beginners?: boolean }): string {
  const lines = [
    `${i.status === 'cancelled' ? 'CANCELLED: ' : ''}${i.title}`,
    `📅 ${i.dateLabel}${i.timeLabel ? `, ${i.timeLabel}` : ''}`,
  ];
  if (i.venueName || i.town) lines.push(`📍 ${[i.venueName, i.town].filter(Boolean).join(', ')}`);
  if (i.lesson) lines.push(`💃 ${i.lesson}`);
  if (i.admission) lines.push(`🎟️ ${i.admission}`);
  if (i.beginners) lines.push('Beginners welcome. No partner needed.');
  lines.push(`More info: ${i.url}`);
  return lines.join('\n');
}

export function shareLinks(i: ShareInput) {
  const text = shareText(i);
  const enc = encodeURIComponent;
  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(i.url)}`,
    email: `mailto:?subject=${enc(i.title)}&body=${enc(text)}`,
    sms: `sms:?&body=${enc(text)}`,
    text,
  };
}
