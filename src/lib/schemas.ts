/**
 * Content schemas shared by Astro content collections, the ingest pipeline and tests.
 * Builders take an `image` helper so tests can substitute a plain string schema.
 *
 * Entities (brief §3) are linked by id (the file name without extension):
 * Event -> Venue, Organizer, Performers, Instructors, DanceStyles, Source.
 */
import { z } from 'astro/zod';
import { DATE_RE, LOCAL_DATETIME_RE, TIME_RE, isValidTimeZone, normaliseLocalValue, normaliseTimeValue, parseLocal } from './time';
import { RRULE_ERROR, validateRRule } from './rrule';

export type ImageHelper<I extends z.ZodType = z.ZodType> = () => I;

/** What kind of event it is. Ids are URL-safe; labels are what visitors see. */
export const EVENT_CATEGORIES = ['social-dance', 'class-lesson', 'lesson-party', 'live-music', 'festival'] as const;
export const CATEGORY_LABELS: Record<(typeof EVENT_CATEGORIES)[number], string> = {
  'social-dance': 'Social dance',
  'class-lesson': 'Class or lesson',
  'lesson-party': 'Lesson + dance party',
  'live-music': 'Live music',
  festival: 'Festival or weekend event',
};
/** One-line plain-language meaning of each category (shown in filters and the FAQ). */
export const CATEGORY_HELP: Record<(typeof EVENT_CATEGORIES)[number], string> = {
  'social-dance': 'A night of dancing, usually with a DJ.',
  'class-lesson': 'A class where a teacher shows you steps. Some are a series.',
  'lesson-party': 'A short group lesson first, then open dancing.',
  'live-music': 'A band or singer plays live. The dancing score tells you if people dance.',
  festival: 'A big event, often over a full day or weekend.',
};

/** active = listed; past = ended (kept for history); cancelled = shown as cancelled; pending-review = hidden until checked. */
export const EVENT_STATUSES = ['active', 'past', 'cancelled', 'pending-review'] as const;
export const SKILL_LEVELS = ['all-levels', 'beginner', 'intermediate', 'advanced', 'mixed'] as const;
export const SKILL_LABELS: Record<(typeof SKILL_LEVELS)[number], string> = {
  'all-levels': 'All levels welcome',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  mixed: 'Several levels',
};

export const COUNTIES = ['Nassau', 'Suffolk'] as const;
export const PERFORMER_TYPES = ['band', 'dj', 'solo'] as const;
export const PERFORMER_TYPE_LABELS: Record<(typeof PERFORMER_TYPES)[number], string> = { band: 'Band', dj: 'DJ', solo: 'Singer or solo act' };
export const ORGANIZER_TYPES = ['studio', 'club', 'nonprofit', 'promoter', 'venue', 'school', 'dj', 'instructor', 'other'] as const;
export const ORGANIZER_TYPE_LABELS: Record<(typeof ORGANIZER_TYPES)[number], string> = {
  studio: 'Dance studio',
  club: 'Dance club',
  nonprofit: 'Nonprofit group',
  promoter: 'Event promoter',
  venue: 'Venue',
  school: 'School or college',
  dj: 'DJ',
  instructor: 'Teacher',
  other: 'Organizer',
};
export const SOURCE_TYPES = ['jsonld', 'ical', 'html', 'pdf', 'api'] as const;
export const SOURCE_STATUSES = ['never', 'ok', 'empty', 'invalid', 'error', 'skipped'] as const;
export const SOURCE_CADENCES = ['daily', 'twice-weekly', 'weekly', 'monthly', 'seasonal', 'manual'] as const;
export const SOURCE_CATALOG_STATUSES = ['live', 'in-progress', 'verified', 'recheck-from-ci', 'needs-permission', 'manual-intake', 'seasonal-recheck'] as const;
export const SOURCE_PERMISSION_STATUSES = ['not-needed', 'needed', 'requested', 'granted', 'denied'] as const;
export const STYLE_FAMILIES = ['swing', 'ballroom', 'latin', 'tango', 'country', 'other'] as const;

/**
 * Three kinds of dancing. Every dance style belongs to one, and venues and bands record which kinds
 * people actually do there (see src/lib/dancing.ts).
 */
export const DANCE_TYPES = ['partner', 'line', 'freestyle'] as const;
export type DanceType = (typeof DANCE_TYPES)[number];
export const DANCE_TYPE_LABELS: Record<DanceType, string> = {
  partner: 'Partner dancing',
  line: 'Line dancing',
  freestyle: 'Party dancing',
};
export const DANCE_TYPE_HELP: Record<DanceType, string> = {
  partner: 'Two people dance together with steps you can learn, like swing, salsa, hustle, tango or ballroom. You can come alone and ask people to dance.',
  line: 'Everyone does the same steps in rows, often to country music. No partner needed.',
  freestyle: 'Dance however you like to a band or DJ, like at a club, bar or wedding. No steps or partner needed.',
};

/** What a venue is like for dancing, from research. */
export const VENUE_FLOORS = ['dance-floor', 'open-space', 'small', 'seated', 'unknown'] as const;
export const VENUE_FLOOR_LABELS: Record<(typeof VENUE_FLOORS)[number], string> = {
  'dance-floor': 'Has a dance floor',
  'open-space': 'Room to dance near the band',
  small: 'Small space; a few people dance',
  seated: 'Mostly seats; little or no dancing',
  unknown: 'Not sure yet',
};
export const VENUE_KINDS = ['bar', 'restaurant', 'nightclub', 'brewery', 'winery', 'distillery', 'theater', 'concert-hall', 'park', 'beach', 'library', 'lodge-hall', 'dance-studio', 'school', 'festival', 'marina-club', 'other'] as const;
/** How much people dance at a band's or DJ's shows, from research. */
export const BAND_RATINGS = ['dance-band', 'party', 'mixed', 'listening', 'unknown'] as const;
export const BAND_RATING_LABELS: Record<(typeof BAND_RATINGS)[number], string> = {
  'dance-band': 'Plays for dancers',
  party: 'Party band: crowds often dance',
  mixed: 'Some people dance',
  listening: 'Mostly for listening',
  unknown: 'Not sure yet',
};
/** Hints an adapter reads from a listing that help guess whether people will dance. */
export const DANCING_CUES = ['dj', 'dance-party', 'theater', 'library', 'brunch', 'festival', 'outdoor', 'tribute', 'acoustic', 'jam', 'afternoon'] as const;
export type DancingCue = (typeof DANCING_CUES)[number];

/** Treat CMS empty values ("", null) as "not provided". */
const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
export const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema.optional());
const optList = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === null || v === '' ? undefined : v), z.array(schema).optional());
const list = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === null || v === '' || v === undefined ? [] : v), z.array(schema));

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugField = z.string().regex(SLUG_RE, 'Use lowercase letters, numbers and single hyphens only (for example "club-brumidi").');
const idRef = slugField;
export const dateField = z.preprocess(normaliseLocalValue, z.string().regex(DATE_RE, 'Use the date format YYYY-MM-DD.'));
export const timeField = z.preprocess(normaliseTimeValue, z.string().regex(TIME_RE, 'Use 24-hour time HH:mm, for example 19:30 for 7:30 PM.'));
export const localDateTimeField = z.preprocess(
  normaliseLocalValue,
  z
    .string()
    .regex(
      LOCAL_DATETIME_RE,
      'Use local date and time without a timezone offset: YYYY-MM-DDTHH:mm (for example 2026-10-06T19:30), or YYYY-MM-DD if the time is not known yet.',
    ),
);
export const timezoneField = z.string().refine(isValidTimeZone, 'Use an IANA timezone such as America/New_York.');
const money = opt(z.coerce.number().min(0, 'Prices cannot be negative.').max(2000));
const url = opt(z.url({ message: 'Enter a full web address starting with https://' }));
const email = opt(z.email({ message: 'Enter a valid email address.' }));
const phone = opt(z.string().regex(/^[0-9()+.\-\s]{7,25}$/, 'Enter a phone number such as (631) 476-3707.'));
/** Extra labelled links, e.g. a Meetup group or an events calendar. */
const moreLinks = optList(z.object({ label: z.string().min(2).max(40), url: z.url({ message: 'Enter a full web address starting with https://' }) }));
const seo = {
  seoTitle: opt(z.string().max(70, 'Keep SEO titles under 70 characters.')),
  seoDescription: opt(z.string().max(170, 'Keep SEO descriptions under 170 characters.')),
};
/** Other spellings used by sources, for matching (e.g. "Club Brumidi", "Brumidi Lodge"). */
const aliases = list(z.string().min(2));
/** A web page, review or photo page that supports a fact, described in our own words. */
const evidence = list(z.object({ url: z.url({ message: 'Enter a full web address starting with https://' }), note: z.string().max(240) }));
const researchConfidence = z.enum(['high', 'medium', 'low']).default('low');

/** Is there dancing at this venue, and what kind? From research (venue site, reviews, public photos). */
export const venueDancingSchema = z.object({
  floor: z.enum(VENUE_FLOORS).default('unknown'),
  policy: z.enum(['encouraged', 'allowed', 'discouraged', 'unknown']).default('unknown'),
  kinds: list(z.enum(DANCE_TYPES)),
  notes: opt(z.string().max(400)),
  evidence,
  confidence: researchConfidence,
  checked: opt(dateField),
});

/** Do people dance at this band's or DJ's shows, and how? From research. */
export const performerDancingSchema = z.object({
  rating: z.enum(BAND_RATINGS).default('unknown'),
  kinds: list(z.enum(DANCE_TYPES)),
  /** Dance style ids people do at their shows (e.g. freestyle, line-dancing, east-coast-swing). */
  styles: list(idRef),
  notes: opt(z.string().max(400)),
  evidence,
  confidence: researchConfidence,
  checked: opt(dateField),
});
const socials = {
  website: url,
  facebookUrl: url,
  instagramUrl: url,
  youtubeUrl: url,
  moreLinks,
};
/** Point to keep in view when a photo is cropped, as "x% y%" from the top-left. */
export const FOCUS_RE = /^\d{1,3}% \d{1,3}%$/;
const focus = opt(z.string().regex(FOCUS_RE, 'Use a focus point such as "50% 30%".'));
const imageWithAlt = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z.object({
    image: image(),
    alt: z.string().min(3, 'Describe the image for people who cannot see it.'),
    caption: opt(z.string()),
    credit: opt(z.string()),
    creditUrl: url,
    focus,
    video: opt(z.string().regex(/^\/media\/videos\/[\w.-]+\.mp4$/, 'Use a path such as /media/videos/clip.mp4.')),
  });

export const recurrenceSchema = z
  .object({
    /** RFC 5545 rule without "RRULE:", e.g. FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027. Supported: FREQ (WEEKLY, MONTHLY), INTERVAL, BYDAY (with 1-4/-1 for monthly), UNTIL, COUNT. */
    rrule: opt(z.string().refine((r) => validateRRule(r) === null, { message: RRULE_ERROR })),
    /** Extra dates (YYYY-MM-DD) on top of the rule, or the full list when there is no rule. */
    rdates: list(dateField),
    /** Dates removed from the rule, e.g. "No class October 19". */
    exdates: list(dateField),
  })
  .refine((r) => r.rrule || r.rdates.length > 0, { message: 'Add a repeat rule or at least one extra date.' });

export const eventSchema = z
  .object({
    title: z.string().min(3, 'Give the event a title.').max(120),
    /** Short factual summary written in our own words (never copied from the source). */
    summary: z.string().min(10).max(320, 'Keep the summary under 320 characters.'),
    category: z.enum(EVENT_CATEGORIES),
    danceStyles: list(idRef),
    start: localDateTimeField,
    end: opt(localDateTimeField),
    timezone: timezoneField.default('America/New_York'),
    recurrence: opt(recurrenceSchema),
    /** Plain-language repeat pattern from the source, e.g. "1st and 3rd Fridays". */
    cadence: opt(z.string().max(80)),
    lessonTime: opt(timeField),
    venueId: opt(idRef),
    /** Town when the venue is not known yet (used for the Long Island scope check). */
    town: opt(z.string()),
    performerIds: list(idRef),
    instructorIds: list(idRef),
    organizerId: opt(idRef),
    /** Lowest per-person price in US dollars. */
    price: money,
    priceMax: money,
    isFree: opt(z.boolean()),
    priceNotes: opt(z.string().max(160)),
    skillLevel: z.enum(SKILL_LEVELS).default('all-levels'),
    ageGroup: opt(z.enum(['adults', 'kids', 'teens', 'all-ages'])),
    ticketUrl: url,
    infoUrl: url,
    contactPhone: phone,
    contactEmail: email,
    /** Source registry id (src/content/sources). */
    sourceId: idRef,
    /** Where this listing was found (attribution link). */
    sourceUrl: z.url({ message: 'Enter a full web address starting with https://' }),
    /** Human attribution, e.g. "The Dance Calendar, October 2026". */
    sourceName: opt(z.string()),
    /** Where in the source, e.g. "page 17". */
    sourceRef: opt(z.string().max(120)),
    firstSeen: dateField,
    lastSeen: dateField,
    status: z.enum(EVENT_STATUSES).default('active'),
    cancelledNote: opt(z.string().max(200)),
    /** 0-1: how sure the ingest was about this record. Low scores go to pending-review. */
    confidence: z.coerce.number().min(0).max(1).default(1),
    /** Optional cached vector for "find similar" and dedup. Normally kept outside the content files. */
    embedding: optList(z.number()),
    /** Hints from the listing about dancing (set by the adapter, e.g. "theater", "dj"). */
    dancingCues: list(z.enum(DANCING_CUES)),
    /** Editor's answer to "can you dance here?". Overrides the computed dancing score. */
    dancing: opt(
      z.object({
        likelihood: z.coerce.number().min(0).max(1),
        kinds: list(z.enum(DANCE_TYPES)),
        notes: opt(z.string().max(300)),
      }),
    ),
    /** Ids of duplicate records that were merged into this one. */
    mergedFrom: list(z.string()),
    /** Fields an editor fixed by hand. The weekly scrape never overwrites them. */
    lockedFields: list(z.string()),
    /** Internal key the ingest uses to recognize the same listing on the next run. */
    matchKey: opt(z.string().max(240)),
    /** Internal note for editors. Never shown publicly. */
    reviewNotes: opt(z.string()),
    ...seo,
  })
  .superRefine((e, ctx) => {
    if (e.end) {
      const s = parseLocal(e.start);
      const en = parseLocal(e.end);
      if (en.date < s.date) ctx.addIssue({ code: 'custom', path: ['end'], message: 'The end must be on or after the start date.' });
    }
    if (e.price !== undefined && e.priceMax !== undefined && e.priceMax < e.price) {
      ctx.addIssue({ code: 'custom', path: ['priceMax'], message: 'The highest price must be at least the lowest price.' });
    }
    if (e.isFree && e.price) ctx.addIssue({ code: 'custom', path: ['isFree'], message: 'A free event cannot also have a price.' });
    if (e.lastSeen < e.firstSeen) ctx.addIssue({ code: 'custom', path: ['lastSeen'], message: 'Last seen must be on or after first seen.' });
    if (!e.venueId && !e.town) ctx.addIssue({ code: 'custom', path: ['venueId'], message: 'Choose a venue, or at least enter the town.' });
  });

export const venueSchema = z.object({
  name: z.string().min(2),
  aliases,
  address: z.string(),
  town: z.string(),
  county: z.enum(COUNTIES),
  state: z.string().default('NY'),
  postalCode: opt(z.string()),
  phone,
  website: url,
  latitude: opt(z.coerce.number().min(-90).max(90)),
  longitude: opt(z.coerce.number().min(-180).max(180)),
  /** Where the map coordinates came from, e.g. "U.S. Census Bureau Geocoder" (filled in automatically). */
  coordinatesSource: opt(z.string()),
  googleMapsUrl: url,
  facebookUrl: url,
  parkingNotes: opt(z.string()),
  accessibilityNotes: opt(z.string()),
  /** Where facts such as parking came from. */
  factsSource: opt(z.string()),
  description: opt(z.string().max(600)),
  kind: opt(z.enum(VENUE_KINDS)),
  dancing: opt(venueDancingSchema),
  ...seo,
  reviewNotes: opt(z.string()),
});

export const performerSchema = z.object({
  name: z.string().min(2),
  type: z.enum(PERFORMER_TYPES),
  aliases,
  genres: list(z.string()),
  ...socials,
  description: opt(z.string().max(600)),
  dancing: opt(performerDancingSchema),
  ...seo,
  reviewNotes: opt(z.string()),
});

export const instructorSchema = z.object({
  name: z.string().min(2),
  aliases,
  styles: list(idRef),
  affiliatedOrganizerIds: list(idRef),
  ...socials,
  description: opt(z.string().max(600)),
  ...seo,
  reviewNotes: opt(z.string()),
});

export const organizerSchema = z.object({
  name: z.string().min(2),
  type: z.enum(ORGANIZER_TYPES),
  aliases,
  ...socials,
  email,
  phone,
  town: opt(z.string()),
  homeVenueId: opt(idRef),
  danceStyles: list(idRef),
  description: opt(z.string().max(600)),
  /** The organizer asked not to be listed: the ingest drops their events (brief §5). */
  optOut: z.boolean().default(false),
  ...seo,
  reviewNotes: opt(z.string()),
});

export const styleSchema = z.object({
  name: z.string(),
  family: z.enum(STYLE_FAMILIES),
  /** Partner, line or party (freestyle) dancing. */
  danceType: z.enum(DANCE_TYPES).default('partner'),
  order: z.coerce.number().int().default(50),
  /** Words that mean this style in listings (case-insensitive, whole words), e.g. "WCS". */
  aliases,
  summary: z.string().max(240),
  description: opt(z.string()),
  music: opt(z.string()),
});

export const sourceSchema = z.object({
  name: z.string().min(2),
  url: z.url(),
  type: z.enum(SOURCE_TYPES),
  /** Adapter module name in ingest/adapters/. */
  adapter: slugField,
  cadence: z.enum(SOURCE_CADENCES).default('weekly'),
  /** dance = a dance calendar (everything listed is a dance or class); music = a live-music list (dancing varies). */
  focus: z.enum(['dance', 'music']).default('dance'),
  enabled: z.boolean().default(true),
  /** .ics feed, JSON-LD sitemap/list page or JSON API the generic adapters read. */
  feedUrl: url,
  /** Extra pages to read (event detail pages, month pages). */
  pageUrls: list(z.url()),
  /** Facts used when a listing does not say them (registry ids). */
  defaults: opt(
    z.object({
      venueId: opt(idRef),
      town: opt(z.string()),
      organizerId: opt(idRef),
      performerIds: list(idRef),
      danceStyles: list(idRef),
      category: opt(z.enum(EVENT_CATEGORIES)),
    }),
  ),
  /** Keep / drop listings whose title or text matches (case-insensitive regex). */
  include: opt(z.string().max(200)),
  exclude: opt(z.string().max(200)),
  /** Catalog status (catalog/sources.json) and why the source is off. */
  catalogStatus: opt(z.enum(SOURCE_CATALOG_STATUSES)),
  permission: opt(
    z.object({
      status: z.enum(SOURCE_PERMISSION_STATUSES),
      note: opt(z.string().max(300)),
      requestedAt: opt(dateField),
      decidedAt: opt(dateField),
      feedUrl: url,
    }),
  ),
  /** Plain-language credit shown on the Sources page. */
  attribution: z.string().max(300),
  description: opt(z.string().max(400)),
  /** Seconds between requests to this site. */
  rateLimitSeconds: z.coerce.number().min(1).max(60).default(3),
  lastScraped: opt(z.string()),
  lastStatus: z.enum(SOURCE_STATUSES).default('never'),
  lastMessage: opt(z.string().max(500)),
  lastCounts: opt(z.object({ found: z.number().int(), kept: z.number().int(), outOfArea: z.number().int().default(0), needsReview: z.number().int().default(0) })),
  reviewNotes: opt(z.string()),
});

export const pageSchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z.object({
    title: z.string(),
    heading: opt(z.string()),
    lede: opt(z.string()),
    ...seo,
    image: opt(image()),
    imageAlt: opt(z.string().min(3)),
    highlights: optList(z.object({ title: z.string(), text: z.string() })),
    editorialReview: opt(z.string()),
  });

export const gallerySchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z.object({
    title: z.string(),
    date: opt(dateField),
    description: opt(z.string()),
    order: z.coerce.number().int().default(50),
    published: z.boolean().default(true),
    homepageSlideshow: z.boolean().default(false),
    images: z.array(imageWithAlt(image)).min(1, 'Add at least one photo.'),
    source: opt(z.string()),
    rightsNote: opt(z.string()),
  });

export const faqSchema = z.object({
  question: z.string().min(5),
  answer: z.string().min(5),
  category: z.enum(['finding-events', 'going-dancing', 'listings', 'about-site']).default('going-dancing'),
  order: z.coerce.number().int().default(50),
  published: z.boolean().default(true),
  editorialReview: opt(z.string()),
});

export const settingsSchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z.object({
    siteName: z.string(),
    shortName: z.string(),
    region: z.string(),
    tagline: z.string(),
    description: z.string().max(200),
    mission: z.string(),
    /** Public repository (corrections, listing requests and bug reports go to its issue forms). */
    repoUrl: z.url(),
    email: email,
    facebookUrl: url,
    facebookLabel: opt(z.string()),
    timezone: timezoneField.default('America/New_York'),
    counties: z.array(z.enum(COUNTIES)).min(1),
    mapCenter: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
    maxDistanceKm: z.coerce.number().min(1).max(1000),
    socialImage: opt(image()),
    socialImageAlt: opt(z.string()),
  });

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type SkillLevel = (typeof SKILL_LEVELS)[number];
export type County = (typeof COUNTIES)[number];
export type EventData = z.infer<typeof eventSchema>;
export type EventInput = z.input<typeof eventSchema>;
export type VenueData = z.infer<typeof venueSchema>;
export type PerformerData = z.infer<typeof performerSchema>;
export type InstructorData = z.infer<typeof instructorSchema>;
export type OrganizerData = z.infer<typeof organizerSchema>;
export type StyleData = z.infer<typeof styleSchema>;
export type SourceData = z.infer<typeof sourceSchema>;
