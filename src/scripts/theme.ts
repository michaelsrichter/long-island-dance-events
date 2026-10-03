/**
 * Light / dark mode. The choice is kept in this browser only (localStorage "site-theme") and applied
 * before the page draws by the inline script in BaseLayout, so there is no flash.
 * "Auto" (the default) removes the choice and follows the device setting.
 */
import { track } from './analytics';

type Choice = 'light' | 'dark' | 'auto';
const KEY = 'site-theme';
const root = document.documentElement;
const deviceDark = window.matchMedia('(prefers-color-scheme: dark)');

let choice: Choice = root.dataset.theme === 'light' || root.dataset.theme === 'dark' ? root.dataset.theme : 'auto';

const effective = () => (choice === 'auto' ? (deviceDark.matches ? 'dark' : 'light') : choice);

function sync() {
  const now = effective();
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((b) => {
    const label = now === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    b.setAttribute('aria-label', label);
    b.title = label;
  });
  document.querySelectorAll<HTMLInputElement>('[data-theme-choice] input').forEach((i) => {
    i.checked = i.value === choice;
  });
}

function set(next: Choice, location: string) {
  choice = next;
  if (next === 'auto') delete root.dataset.theme;
  else root.dataset.theme = next;
  try {
    if (next === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Storage blocked (private browsing): the choice still applies to this page.
  }
  sync();
  track('theme_change', { method: next, location });
}

document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((b) => {
  b.addEventListener('click', () => set(effective() === 'dark' ? 'light' : 'dark', b.dataset.themeLocation ?? 'header'));
});
document.querySelectorAll<HTMLElement>('[data-theme-choice]').forEach((group) => {
  group.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.value === 'light' || input.value === 'dark' || input.value === 'auto') set(input.value, group.dataset.themeLocation ?? 'menu');
  });
});
deviceDark.addEventListener('change', sync);
sync();
