/**
 * Loads the community panel code only when the panel is about to scroll into view
 * (or right away after signing in, when the address ends in #community).
 */
const panel = document.querySelector<HTMLElement>('[data-community]');
if (panel) {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    import('./community-app').then((m) => m.init(panel)).catch(() => {});
  };
  if (location.hash === '#community' || !('IntersectionObserver' in window)) start();
  else {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(panel);
  }
}
