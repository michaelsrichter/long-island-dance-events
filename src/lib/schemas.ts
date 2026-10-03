/**
 * Content schemas shared by Astro content collections, validation scripts and tests.
 * Builders take an `image` helper so tests can substitute a plain string schema.
 */
import { z } from 'astro/zod';
import { DATE_RE, LOCAL_DATETIME_RE, TIME_RE, isValidTimeZone, normaliseLocalValue, normaliseTimeValue, parseLocal } from './time';

export type ImageHelper<I extends z.ZodType = z.ZodType> = () => I;

export const EVENT_STATUSES = ['draft', 'scheduled', 'cancelled', 'postponed', 'soldOut', 'completed'] as const;
/** Who runs an event: this site's home organization, or a community listing. */
export const EVENT_HOSTS = ['home', 'community'] as const;
export const HOST_LABELS: Record<(typeof EVENT_HOSTS)[number], string> = { home: 'Home event', community: 'Community event' };
export const EVENT_TYPES = [
  'weekly-dance',
  'monthly-dance',
  'live-band',
  'dj-night',
  'beginner-lesson',
  'workshop',
  'special-event',
  'community-event',
  'social-dance',
  'practice',
  'festival',
  'class',
] as const;
export const EXPERIENCE_LEVELS = ['all-levels', 'beginner', 'intermediate', 'advanced'] as const;

export const EVENT_TYPE_LABELS: Record<(typeof EVENT_TYPES)[number], string> = {
  'weekly-dance': 'Weekly dance',
  'monthly-dance': 'Monthly dance',
  'live-band': 'Live band night',
  'dj-night': 'DJ night',
  'beginner-lesson': 'Beginner lesson',
  workshop: 'Workshop',
  'special-event': 'Special event',
  'community-event': 'Community event',
  'social-dance': 'Social dance',
  practice: 'Practice party',
  festival: 'Dance weekend',
  class: 'Class',
};
export const EXPERIENCE_LABELS: Record<(typeof EXPERIENCE_LEVELS)[number], string> = {
  'all-levels': 'All levels welcome',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/** Treat CMS empty values ("", null) as "not provided". */
const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
export const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema.optional());
const optList = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === null || v === '' ? undefined : v), z.array(schema).optional());

export const slugField = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens only (for example "tuesday-night-swing").');
export const dateField = z.preprocess(normaliseLocalValue, z.string().regex(DATE_RE, 'Use the date format YYYY-MM-DD.'));
export const timeField = z.preprocess(
  normaliseTimeValue,
  z.string().regex(TIME_RE, 'Use 24-hour time HH:mm, for example 19:30 for 7:30 PM.'),
);
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
const money = opt(z.coerce.number().min(0, 'Prices cannot be negative.').max(1000));
const url = opt(z.url({ message: 'Enter a full web address starting with https://' }));
const email = opt(z.email({ message: 'Enter a valid email address.' }));
const phone = opt(z.string().regex(/^[0-9()+.\-\s]{7,25}$/, 'Enter a phone number such as (631) 476-3707.'));
/** Extra labelled links, e.g. a Meetup group or an events calendar. */
const moreLinks = optList(
  z.object({
    label: z.string().min(2).max(40),
    url: z.url({ message: 'Enter a full web address starting with https://' }),
  }),
);
const seo = {
  seoTitle: opt(z.string().max(70, 'Keep SEO titles under 70 characters.')),
  seoDescription: opt(z.string().max(170, 'Keep SEO descriptions under 170 characters.')),
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
    /** Link for the credit, e.g. the photo's license page. */
    creditUrl: url,
    focus,
    /**
     * Optional short, silent video clip (an .mp4 under /media/videos/). The photo is shown as its poster
     * and for anyone who prefers reduced motion.
     */
    video: opt(z.string().regex(/^\/media\/videos\/[\w.-]+\.mp4$/, 'Use a path such as /media/videos/clip.mp4.')),
  });

/** Fields shared by one-time events, series templates and occurrence overrides. */
const eventDetailFields = <I extends z.ZodType>(image: ImageHelper<I>) => ({
  host: opt(z.enum(EVENT_HOSTS)),
  /** Community organizer ID (organizers collection). Home events do not need one. */
  organizer: opt(z.string()),
  /** Organizer's page for this event, or where to find more information. */
  infoUrl: url,
  /** Where a community listing came from, e.g. "Sample Community Calendar, October 2026". */
  sourceName: opt(z.string()),
  sourceUrl: url,
  /** Plain-language repeat pattern shown on community listings, e.g. "Every Wednesday". */
  cadence: opt(z.string()),
  summary: opt(z.string().max(300, 'Keep the summary under 300 characters.')),
  doorsTime: opt(timeField),
  lessonStartTime: opt(timeField),
  danceStartTime: opt(timeField),
  danceEndTime: opt(timeField),
  timezone: opt(timezoneField),
  venue: opt(z.string()),
  address: opt(z.string()),
  city: opt(z.string()),
  state: opt(z.string()),
  postalCode: opt(z.string()),
  latitude: opt(z.coerce.number().min(-90).max(90)),
  longitude: opt(z.coerce.number().min(-180).max(180)),
  directionsUrl: url,
  instructorNames: optList(z.string()),
  djNames: optList(z.string()),
  bandName: opt(z.string()),
  danceStyles: optList(z.string()),
  eventTypes: optList(z.enum(EVENT_TYPES)),
  experienceLevel: opt(z.enum(EXPERIENCE_LEVELS)),
  partnerRequired: opt(z.boolean()),
  beginnerFriendly: opt(z.boolean()),
  admissionMember: money,
  admissionNonMember: money,
  admissionStudent: money,
  admissionNotes: opt(z.string()),
  registrationUrl: url,
  registrationRequired: opt(z.boolean()),
  capacityNotes: opt(z.string()),
  featuredImage: opt(image()),
  featuredImageAlt: opt(z.string().min(3)),
  featuredImageFocus: focus,
  gallery: optList(imageWithAlt(image)),
  sponsor: opt(z.string()),
  contactName: opt(z.string()),
  contactEmail: email,
  contactPhone: phone,
  facebookEventUrl: url,
  ...seo,
  lastUpdated: opt(dateField),
  /** Internal note for editors listing facts that still need confirmation. Never rendered publicly. */
  editorialReview: opt(z.string()),
  legacyUrl: opt(z.string()),
});

function requireAlt(e: { featuredImage?: unknown; featuredImageAlt?: string | undefined }, ctx: z.RefinementCtx) {
  if (e.featuredImage && !e.featuredImageAlt) {
    ctx.addIssue({ code: 'custom', path: ['featuredImageAlt'], message: 'Alt text is required when a featured image is set.' });
  }
}

export const eventSchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z
    .object({
      title: z.string().min(3, 'Give the event a title.').max(120),
      slug: opt(slugField),
      status: z.enum(EVENT_STATUSES).default('scheduled'),
      published: z.boolean().default(true),
      featured: z.boolean().default(false),
      series: opt(z.string()),
      occurrenceDate: opt(dateField),
      startDateTime: opt(localDateTimeField),
      endDateTime: opt(localDateTimeField),
      cancelledMessage: opt(z.string()),
      postponedTo: opt(z.string()),
      ...eventDetailFields(image),
    })
    .superRefine((e, ctx) => {
      requireAlt(e, ctx);
      if (e.series && !e.occurrenceDate) {
        ctx.addIssue({ code: 'custom', path: ['occurrenceDate'], message: 'Choose which series date this entry changes.' });
      }
      if (!e.series && !e.startDateTime) {
        ctx.addIssue({ code: 'custom', path: ['startDateTime'], message: 'A start date is required for one-time events.' });
      }
      if (e.startDateTime && e.endDateTime) {
        const s = parseLocal(e.startDateTime);
        const en = parseLocal(e.endDateTime);
        if (`${en.date}T${en.time ?? '23:59'}` < `${s.date}T${s.time ?? '00:00'}`) {
          ctx.addIssue({ code: 'custom', path: ['endDateTime'], message: 'The end must be after the start.' });
        }
      }
      if (e.lessonStartTime && e.danceStartTime && e.lessonStartTime > e.danceStartTime) {
        ctx.addIssue({ code: 'custom', path: ['lessonStartTime'], message: 'The lesson should start before open dancing.' });
      }
    });

export const seriesSchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z
    .object({
      title: z.string().min(3).max(120),
      slug: slugField,
      published: z.boolean().default(true),
      recurrence: z.object({
        frequency: z.enum(['weekly', 'monthly']),
        interval: z.coerce.number().int().min(1).max(4).default(1),
        weekday: z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
        /** For monthly series: 1-4 for "first".."fourth", -1 for "last". */
        weekOfMonth: opt(z.coerce.number().int().refine((n) => [1, 2, 3, 4, -1].includes(n), 'Use 1, 2, 3, 4 or -1 (last).')),
        startDate: dateField,
        endDate: opt(dateField),
        /** How far ahead occurrences are published. */
        horizonWeeks: z.coerce.number().int().min(1).max(52).default(12),
        exceptDates: optList(dateField),
      }),
      startTime: timeField,
      endTime: timeField,
      ...eventDetailFields(image),
    })
    .superRefine((s, ctx) => {
      requireAlt(s, ctx);
      if (s.recurrence.frequency === 'monthly' && s.recurrence.weekOfMonth === undefined) {
        ctx.addIssue({ code: 'custom', path: ['recurrence', 'weekOfMonth'], message: 'Monthly series need a week of the month.' });
      }
      if (s.recurrence.endDate && s.recurrence.endDate < s.recurrence.startDate) {
        ctx.addIssue({ code: 'custom', path: ['recurrence', 'endDate'], message: 'The series end date must be after its start date.' });
      }
    });

export const venueSchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z
    .object({
      name: z.string().min(2),
      shortName: opt(z.string()),
      active: z.boolean().default(true),
      address: z.string(),
      city: z.string(),
      state: z.string().default('NY'),
      postalCode: opt(z.string()),
      phone: phone,
      website: url,
      latitude: opt(z.coerce.number().min(-90).max(90)),
      longitude: opt(z.coerce.number().min(-180).max(180)),
      /** Where the map coordinates came from, e.g. "U.S. Census Bureau Geocoder" (filled in automatically). */
      coordinatesSource: opt(z.string()),
      directionsUrl: url,
      /** Google Maps listing (photos, reviews, hours). */
      googleMapsUrl: url,
      facebookUrl: url,
      parkingNotes: opt(z.string()),
      accessibilityNotes: opt(z.string()),
      /** Where facts such as parking came from, e.g. "Google Maps listing and reviews (October 2026)". */
      factsSource: opt(z.string()),
      image: opt(image()),
      imageAlt: opt(z.string().min(3)),
      ...seo,
      editorialReview: opt(z.string()),
      legacyUrl: opt(z.string()),
    })
    .superRefine((v, ctx) => {
      if (v.image && !v.imageAlt) ctx.addIssue({ code: 'custom', path: ['imageAlt'], message: 'Alt text is required for venue images.' });
    });

export const personSchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z
    .object({
      name: z.string().min(2),
      kind: z.enum(['instructor', 'dj', 'band']),
      role: opt(z.string()),
      website: url,
      facebookUrl: url,
      instagramUrl: url,
      youtubeUrl: url,
      moreLinks,
      /** Community organizer they run, e.g. "triple-step-swing". */
      organizer: opt(z.string()),
      members: optList(z.string()),
      danceStyles: optList(z.string()),
      image: opt(image()),
      imageAlt: opt(z.string().min(3)),
      imageFocus: focus,
      imageCredit: opt(z.string()),
      ...seo,
      editorialReview: opt(z.string()),
      legacyUrl: opt(z.string()),
    })
    .superRefine((p, ctx) => {
      if (p.image && !p.imageAlt) ctx.addIssue({ code: 'custom', path: ['imageAlt'], message: 'Alt text is required for profile images.' });
    });

export const styleSchema = z.object({
  name: z.string(),
  order: z.coerce.number().int().default(50),
  /** "swing" styles are common at the home dance; "other" styles appear at community events. */
  family: z.enum(['swing', 'other']).default('swing'),
  summary: z.string().max(240),
  description: opt(z.string()),
  tempo: opt(z.string()),
});

export const organizerSchema = z.object({
  name: z.string().min(2),
  shortName: opt(z.string()),
  active: z.boolean().default(true),
  website: url,
  email: email,
  phone: phone,
  phoneAlt: phone,
  facebookUrl: url,
  instagramUrl: url,
  moreLinks,
  /** Main town, e.g. "Deer Park". */
  town: opt(z.string()),
  /** Usual venue ID. */
  venue: opt(z.string()),
  danceStyles: optList(z.string()),
  /** One line describing what they run, e.g. "Wednesday Ballroom & Latin socials". */
  tagline: opt(z.string().max(160)),
  /** Classes they offer, shown under "Take a class". Leave empty if they only run dances. */
  classes: opt(z.string().max(240)),
  sourceName: opt(z.string()),
  sourceUrl: url,
  editorialReview: opt(z.string()),
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

export const announcementSchema = z.object({
  message: z.string().min(3).max(240),
  linkUrl: opt(z.string()),
  linkText: opt(z.string()),
  level: z.enum(['info', 'important']).default('info'),
  startDate: opt(dateField),
  endDate: opt(dateField),
  published: z.boolean().default(true),
});

export const gallerySchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z.object({
    title: z.string(),
    date: opt(dateField),
    description: opt(z.string()),
    order: z.coerce.number().int().default(50),
    published: z.boolean().default(true),
    /** Also show this album's photos in the rotating slideshow at the top of the homepage. */
    homepageSlideshow: z.boolean().default(false),
    images: z.array(imageWithAlt(image)).min(1, 'Add at least one photo.'),
    source: opt(z.string()),
    rightsNote: opt(z.string()),
  });

export const faqSchema = z.object({
  question: z.string().min(5),
  answer: z.string().min(5),
  category: z.enum(['first-visit', 'dancing', 'admission', 'venue', 'membership', 'volunteering']).default('first-visit'),
  order: z.coerce.number().int().default(50),
  published: z.boolean().default(true),
  editorialReview: opt(z.string()),
});

export const settingsSchema = <I extends z.ZodType>(image: ImageHelper<I>) =>
  z.object({
    siteName: z.string(),
    shortName: z.string(),
    legalName: z.string(),
    region: z.string(),
    tagline: z.string(),
    description: z.string().max(200),
    mission: z.string(),
    hotlinePhone: z.string(),
    hotlineLabel: z.string().default('24-hour Dance Hotline'),
    email: z.email(),
    mailingAddress: z.object({
      line1: z.string(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
    }),
    newsletterUrl: url,
    facebookUrl: url,
    facebookLabel: opt(z.string()),
    instagramUrl: url,
    youtubeUrl: url,
    membershipFee: z.coerce.number().min(0),
    membershipYear: z.string(),
    standardPrices: z
      .array(
        z.object({
          label: z.string(),
          member: z.coerce.number().min(0),
          student: z.coerce.number().min(0),
          nonMember: z.coerce.number().min(0),
        }),
      )
      .default([]),
    defaultVenue: opt(z.string()),
    mapCenter: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).optional(),
    maxDistanceKm: z.coerce.number().min(1).max(1000).optional(),
    socialImage: opt(image()),
    socialImageAlt: opt(z.string()),
  });

export type EventStatus = (typeof EVENT_STATUSES)[number];
export type EventHost = (typeof EVENT_HOSTS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
