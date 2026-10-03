/** Types shared by adapters and the pipeline. */
import type { EventCategory, SkillLevel, SourceData } from '../../src/lib/schemas';
import type { Registry } from './registry';
import type { PoliteFetcher } from './fetch';

/** One dated listing produced by an adapter, before repeating dates are combined. */
export interface Candidate {
  sourceId: string;
  sourceUrl: string;
  sourceName: string;
  sourceRef: string;
  date: string;
  start?: string | undefined;
  end?: string | undefined;
  lessonTime?: string | undefined;
  category: EventCategory;
  danceStyles: string[];
  venueId?: string | undefined;
  town: string;
  organizerId?: string | undefined;
  performerIds: string[];
  instructorIds: string[];
  price?: number | undefined;
  priceMax?: number | undefined;
  isFree?: boolean | undefined;
  priceNotes?: string | undefined;
  skillLevel: SkillLevel;
  ageGroup?: 'adults' | 'kids' | 'teens' | 'all-ages' | undefined;
  /** Title and summary for this date (may include a theme such as "Halloween"). */
  title: string;
  summary: string;
  /** Title and summary without the theme, used when dates are combined into a repeating event. */
  seriesTitle: string;
  seriesSummary: string;
  theme?: string | undefined;
  infoUrl?: string | undefined;
  ticketUrl?: string | undefined;
  contactPhone?: string | undefined;
  contactEmail?: string | undefined;
  /** Repeat pattern stated by the source, e.g. "1st and 3rd Fridays of the month". */
  cadence?: string | undefined;
  /** Ordinal weekdays from the source's stated pattern, e.g. [1, 3] for "first and third". */
  cadenceOrdinals?: number[] | undefined;
  confidence: number;
  reviewNotes: string[];
  /** Same on every date of a repeating listing. */
  seriesKey: string;
  /** Themed or special dates are never merged into a repeating event. */
  oneOff: boolean;
}

export interface NormalizeResult {
  candidates: Candidate[];
  found: number;
  outOfArea: { town: string; count: number }[];
  skipped: { reason: string; ref: string }[];
  /** Calendar range this run covered, used to spot listings that disappeared. */
  coverage?: { from: string; to: string } | undefined;
}

export interface AdapterContext {
  source: SourceData & { id: string };
  registry: Registry;
  fetcher: PoliteFetcher;
  today: string;
  offline: boolean;
  log: (msg: string) => void;
}

export interface FetchedDocument {
  url: string;
  /** Path of the cached copy on disk (never committed). */
  file: string;
  contentType: string;
  /** Adapter-specific facts, e.g. { issue: "2026-10" }. */
  meta: Record<string, string>;
}

export interface Adapter {
  id: string;
  fetch(ctx: AdapterContext): Promise<FetchedDocument[]>;
  normalize(docs: FetchedDocument[], ctx: AdapterContext): Promise<NormalizeResult>;
}
