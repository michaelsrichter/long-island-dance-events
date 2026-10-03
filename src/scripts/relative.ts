/** Fills every [data-when] element with a friendly relative label ("Tonight!", "In 4 days"). */
import { relativeLabel } from '../lib/relative';

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
}

applyRelativeLabels();
