/** Accessible live-region toast for copy/share confirmations (no alert()). */
let timer: number | undefined;

export function toast(message: string): void {
  const region = document.querySelector<HTMLElement>('[data-toast]');
  if (!region) return;
  window.clearTimeout(timer);
  region.textContent = '';
  // Re-set on the next frame so screen readers announce repeated messages.
  requestAnimationFrame(() => {
    region.textContent = message;
  });
  timer = window.setTimeout(() => {
    region.textContent = '';
  }, 3500);
}
