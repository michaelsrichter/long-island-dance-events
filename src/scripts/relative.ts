/** Fills every [data-when] element with a friendly relative label ("Tonight!", "In 4 days"), and day headings with "Today"/"Tomorrow". */
import { relativeLabel } from '../lib/relative';

const nyDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export function applyRelativeLabels(root: ParentNode = document, now = Date.now()) {
  root.querySelectorAll<HTMLElement>('[data-when]').forEach((el) => {
    const start = Number(el.dataset.whenStart);
    const end = Number(el.dataset.whenEnd);
    if (!start || !end) return;
    const label = relativeLabel(start, end, now, { excited: el.dataset.whenExcited === 'true', allDay: el.dataset.whenAllDay === 'true' });
    if (!label.text) {
      el.hidden = true;
      return;
    }
    el.textContent = label.text;
    el.dataset.tone = label.tone;
    el.hidden = false;
  });
  const today = nyDate(now);
  const tomorrow = nyDate(now + 86_400_000);
  root.querySelectorAll<HTMLElement>('[data-day-rel]').forEach((el) => {
    const d = el.dataset.dayRel;
    el.textContent = d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : '';
    el.hidden = !el.textContent;
  });
}

applyRelativeLabels();
