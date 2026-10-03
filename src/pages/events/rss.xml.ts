import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getEventGroups, getSettings } from '../../lib/content';

export const GET: APIRoute = async (context) => {
  const [{ upcoming }, settings] = await Promise.all([getEventGroups(), getSettings()]);
  return rss({
    title: `${settings.siteName}: upcoming events`,
    description: settings.description,
    site: context.site!,
    trailingSlash: true,
    items: upcoming.slice(0, 200).map((e) => ({
      title: `${e.status === 'cancelled' ? 'CANCELLED: ' : ''}${e.title} (${e.dateLabel})`,
      link: e.url,
      description: [e.data.summary, `${e.dateLabel}${e.timeLabel ? `, ${e.timeLabel}` : ''}`, e.location.full, `Price: ${e.priceLine}`, `Source: ${e.data.sourceName ?? e.source?.data.name}`]
        .filter(Boolean)
        .join(' — '),
      pubDate: e.start,
    })),
    customData: '<language>en-us</language>',
  });
};
