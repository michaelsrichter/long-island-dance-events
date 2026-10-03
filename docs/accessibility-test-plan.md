# Accessibility test plan

The goal is WCAG 2.2 AA for public pages and a practical editor/visitor experience on keyboard, phone and no-JS browsers.

## Automated checks

Run:

```powershell
npx playwright test tests/e2e/quality.spec.ts
```

Coverage:

- Axe serious/critical scans for key pages.
- 320 px no-horizontal-scroll checks.
- Skip link behavior.
- Mobile menu keyboard behavior.
- Add-to-calendar keyboard behavior.
- Visible focus indicators.
- Touch target size in the next-dance card.
- SEO metadata sanity checks that also catch missing `h1` landmarks.

## Pages scanned

| Page | Why |
| --- | --- |
| `/` | Hero, slideshow, next-dance card, theme controls. |
| `/events/` | Filters, collapsed lists, event cards. |
| `/events/map/` | Map plus accessible list fallback. |
| `/events/calendar/` | Calendar grid/agenda. |
| `/events/past/` and year pages | Archive navigation. |
| Event detail pages | Alerts, price tables, share/calendar controls. |
| Community event page | Organizer/source warnings and links. |
| `/community/` | Organizer cards and classes. |
| `/new-to-swing/`, `/lessons/`, `/faq/` | Beginner content and accordions. |
| `/venues/` and venue detail | Addresses, parking, map links. |
| `/performers/` and profile | Person cards and external links. |
| Static pages | About, membership, gallery, contact, privacy. |
| 404 | Helpful recovery actions. |

## Manual keyboard script

1. Load `/`.
2. Press Tab: skip link should be first and visible.
3. Press Enter: focus moves to `#main`.
4. Tab through header links and theme control.
5. On mobile width, focus the Menu button and press Enter.
6. Confirm menu opens, links are reachable, Escape closes it and focus returns to Menu.
7. Open Add to calendar with Enter.
8. Confirm Google/Outlook/ICS links appear.
9. Press Escape and confirm the menu closes.
10. Continue tabbing through cards and footer; every focus state should be visible.

## Manual screen reader smoke test

Use Narrator, NVDA, VoiceOver or another available reader:

- Homepage: one h1, next-dance card has meaningful labels.
- Events page: filter groups have legends; result count announces changes.
- Event detail: status alert is read before details; price table headers make sense.
- Map page: list of places has the same information as the visual map.
- Share dialog: announces as a dialog and closes with Escape.
- FAQ: questions are buttons/summary elements and answers are readable.

## No-JS check

Playwright covers this, but manually confirm when changing scripts:

- Disable JavaScript.
- `/events/` hides filters.
- All home event cards are visible.
- No Show more button is shown.
- Event detail calendar `.ics` link remains visible.
- Theme controls are hidden and device color scheme is used.

## Content accessibility rules

| Content | Rule |
| --- | --- |
| Images | Real alt text; decorative images use empty alt in components. |
| Flyers | Do not rely on image text for event details. Enter details as text. |
| Links | Link text should describe destination/action. |
| Headings | Use one h1 per page; do not skip heading levels for styling. |
| Tables | Use captions or visible labels for price tables. |
| Alerts | Cancellations and postponements must be text, not only color. |
| Color | Maintain contrast in light and dark themes. |
| Motion | Slideshow can be paused and respects reduced-motion behavior. |

## Known high-risk changes

Run the full e2e suite after:

- Header/navigation changes.
- Filter or collapse script changes.
- Theme token changes.
- Slideshow changes.
- Map marker changes.
- Event card markup changes.
- CMS preview/admin changes.
- Any global CSS refactor.

## Reporting issues

When filing an accessibility bug, include:

- Page URL.
- Browser and assistive technology.
- Viewport size.
- Keyboard/mouse/touch steps.
- Expected behavior.
- Actual behavior.
- Screenshot or short recording if helpful.
