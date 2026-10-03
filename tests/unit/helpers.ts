import { z } from 'astro/zod';
import { eventSchema, seriesSchema } from '../../src/lib/schemas';
import type { RawEvent, RawSeries } from '../../src/lib/event-core';

const img = () => z.string();
export const parseEvent = (data: Record<string, unknown>) => eventSchema(img).parse(data);
export const parseSeries = (data: Record<string, unknown>) => seriesSchema(img).parse(data);

export function ev(id: string, data: Record<string, unknown>): RawEvent {
  return { id, data: parseEvent(data) };
}

export function tuesdaySeries(overrides: Record<string, unknown> = {}): RawSeries {
  return {
    id: 'thursday-night-swing',
    data: parseSeries({
      title: 'Thursday Night Swing',
      slug: 'thursday-night-swing',
      recurrence: { frequency: 'weekly', weekday: 'tuesday', startDate: '2026-10-06', horizonWeeks: 4 },
      startTime: '19:30',
      endTime: '22:00',
      lessonStartTime: '19:30',
      danceStartTime: '20:00',
      danceEndTime: '22:00',
      venue: 'riverbend-community-hall',
      admissionMember: 10,
      admissionStudent: 5,
      admissionNonMember: 15,
      eventTypes: ['weekly-dance', 'dj-night'],
      danceStyles: ['east-coast-swing'],
      ...overrides,
    }),
  };
}

