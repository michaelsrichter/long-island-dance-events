import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getEventGroups, getSettings } from '../../lib/content';

export const GET: APIRoute = async (context) => {
  const [{ upcomingHome: upcoming }, settings] = await Promise.all([getEventGroups(), getSettings()]);
  return rss({
    title: `${settings.siteName}: upcoming dances`,
    description: settings.description,
    site: context.site!,
    trailingSlash: true,
    items: upcoming.map((e) => ({
      title: `${e.status === 'cancelled' ? 'CANCELLED: ' : ''}${e.title} (${e.dateLabel})`,
      link: e.url,
      description: [e.details.summary, `${e.dateLabel}${e.timeLabel ? ` at ${e.timeLabel}` : ''}`, e.location.full, `Admission: ${e.admissionLine}`]
        .filter(Boolean)
        .join(' — '),
      // Publication date is not tracked; use the event start so readers sort by date.
      pubDate: e.start,
    })),
    customData: '<language>en-us</language>',
  });
};
