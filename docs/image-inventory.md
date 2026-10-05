# Image inventory

Use this file to prove every image is safe to publish. Keep it current when adding or removing images.

## Rules

- List every uploaded photo, logo, video poster and public video.
- Use only images your organization owns, created, licensed or has written permission to publish.
- Keep credits and license URLs when required.
- Do not rely on image text for schedules or prices.
- Remove sample photos unless you intentionally keep them with credits.

## Migrated or current images

| File | Source | License / rights | Status |
| --- | --- | --- | --- |
| `lindy-couple-dance-fun.jpg` | Wikimedia Commons: [Dance fun](https://commons.wikimedia.org/wiki/File:Dance_fun.jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `lindy-couple-black-and-yellow.jpg` | Wikimedia Commons: [Lindy Hop dancers in black and yellow](https://commons.wikimedia.org/wiki/File:Lindy_Hop_dancers_in_black_and_yellow.jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `lindy-dancer-teal-top-at-the-dance-hop.jpg` | Wikimedia Commons: [At the dance hop](https://commons.wikimedia.org/wiki/File:At_the_dance_hop_(46265907185).jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `lindy-couple-hand-in-hand.jpg` | Wikimedia Commons: [Hand-in-hand Lindy Hop dancers](https://commons.wikimedia.org/wiki/File:Hand-in-hand_Lindy_Hop_dancers.jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `lindy-same-sex-couple.jpg` | Wikimedia Commons: [Same-sex dancers](https://commons.wikimedia.org/wiki/File:Same-sex_dancers.jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `lindy-dancer-green-jumpsuit-skip-hop.jpg` | Wikimedia Commons: [Skip hop](https://commons.wikimedia.org/wiki/File:Skip_hop_(52961550362).jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `lindy-dancer-red-hat-polka-dots.jpg` | Wikimedia Commons: [Lindy Hop dancer with red hat and red belt](https://commons.wikimedia.org/wiki/File:Lindy_Hop_dancer_with_red_hat_and_red_belt.jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `lindy-dancers-purple-and-green.jpg` | Wikimedia Commons: [Lindy Hop dancers in purple and green](https://commons.wikimedia.org/wiki/File:Lindy_Hop_dancers_in_purple_and_green.jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `lindy-dancer-black-dress.jpg` | Wikimedia Commons: [Lindy Hop dancer in black dress](https://commons.wikimedia.org/wiki/File:Lindy_Hop_dancer_in_black_dress.jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `solo-jazz-dancer-hop-and-a-skip.jpg` | Wikimedia Commons: [Hop and a skip](https://commons.wikimedia.org/wiki/File:Hop_and_a_skip_(52876191506).jpg), Thomas Quine | CC BY 2.0 | Sample only; credit required. |
| `public/favicon.svg` | Original starter mark | Project asset | Replace with your organization's logo. |
| `public/icons/*.png` | Generated from `public/favicon.svg` | Project asset | Regenerate after logo replacement. |

## Not migrated

Use this table for photos or files you choose not to bring over.

| Old image | Reason |
| --- | --- |
| `old-dance-flyer.jpg` | Important event details were text inside the image; enter the schedule as event fields instead. |
| `unknown-photographer-group-photo.jpg` | Permission could not be confirmed. Ask for permission or replace. |

## Placeholders

| Placeholder | Where used | Replacement plan |
| --- | --- | --- |
| Sample CC BY dance photos | Gallery, homepage slideshow, page sections | Replace with organization photos or keep with visible credits. |
| Neutral logo mark | Header, favicon, app icons | Replace before launch. |

## Cropping and focus points

| Image | Suggested focus | Why |
| --- | --- | --- |
| `lindy-couple-dance-fun.jpg` | `50% 32%` | Keeps faces centered. |
| `lindy-dancer-teal-top-at-the-dance-hop.jpg` | `45% 30%` | Keeps dancer's face and partner visible. |
| `lindy-dancer-green-jumpsuit-skip-hop.jpg` | `62% 40%` | Keeps action to the right. |

## Videos

The starter keeps slideshow video support but ships no sample video.

| File | Shows | Status |
| --- | --- | --- |
| TODO | TODO | Confirm permission, add poster image and captions. |

## Open-licensed photos added

All ten sample photos are CC BY 2.0 by Thomas Quine. If kept, credits must remain in `src/content/gallery/swing-style-inspiration.yml` and any page captions that use them.

## Directory pictures (venues, bands and DJs, teachers, organizers, dance styles)

Added October 4, 2026 (decision P41). The **inventory for each picture is in its content file**: every logo and photos item records credit (shown on the page), creditUrl (the page it came from), imageSource (the original file address) and, for Creative Commons photos, licenseUrl. 	ests/unit/directory.test.ts fails the build if a picture has no alt text or credit, a dance-style photo has no license, or a file is missing, too large or still has camera data.

- **Permission:** the owner said we may use logos and pictures from the web unless a site says we may not. Pictures come from each place's or act's **own** website or official page. Dance-style photos are openly licensed from Wikimedia Commons (CC0, public domain, CC BY, CC BY-SA) and the pages say they are examples, not from Long Island events.
- **Never used:** photos uploaded by private people to Google Maps, Yelp, TripAdvisor or Facebook; photos from private groups; anything behind a login; photos with identifiable children; watermarked stock photos; flyers that are mostly text.
- **Takedown:** owners use the [corrections process](https://longisland.dance/sources/#corrections); remove the picture the same day.
- **Files:** `src/assets/entities/<collection>/<id>-logo.webp` and `<id>-1.webp`, `<id>-2.webp`... WebP, camera data removed, photos at most 1200 pixels wide, logos at most 400. Light logos with see-through backgrounds were given a dark background so they show on the white logo plate.

| Kind | Logos | Photos | Size |
| --- | --- | --- | --- |
| venue | 74 | 129 (53 entities) | 13.6 MB |
| performer | 56 | 143 (63 entities) | 11.4 MB |
| instructor | 3 | 9 (5 entities) | 0.6 MB |
| organizer | 9 | 18 (8 entities) | 1.4 MB |
| style | 0 | 35 (14 entities) | 3.5 MB |
| **Total** | | | **30.53 MB** |
