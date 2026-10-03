/** Slideshow behavior: autoplay with pause, previous/next, dots, swipe, reduced-motion support. See Slideshow.astro. */
const INTERVAL = 6000;

function init(root: HTMLElement) {
  const trackEl = root.querySelector<HTMLElement>('[data-slideshow-track]');
  const slides = [...root.querySelectorAll<HTMLElement>('[data-slide]')];
  if (!trackEl || slides.length < 2) return;
  const dots = [...root.querySelectorAll<HTMLButtonElement>('[data-slideshow-dot]')];
  const toggle = root.querySelector<HTMLButtonElement>('[data-slideshow-toggle]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  let playing = !reduced;
  let held = false; // hovered or focused
  let onScreen = true;
  let programmatic = false;

  root.classList.add('is-enhanced');

  function syncVideos() {
    slides.forEach((s, i) => {
      const v = s.querySelector<HTMLVideoElement>('[data-slide-video]');
      if (!v || reduced) return;
      if (i === index && onScreen && !document.hidden) {
        if (!v.src) v.src = v.dataset.src ?? '';
        v.classList.add('is-ready');
        void v.play().catch(() => v.classList.remove('is-ready'));
      } else if (!v.paused) v.pause();
    });
  }

  function render() {
    slides.forEach((s, i) => {
      // Only the visible slide can be tabbed into or read out.
      s.inert = i !== index;
    });
    dots.forEach((d, i) => d.setAttribute('aria-current', i === index ? 'true' : 'false'));
    const count = root.querySelector<HTMLElement>('[data-slideshow-count]');
    if (count) count.textContent = `${index + 1} / ${slides.length}`;
    root.classList.toggle('is-playing', playing);
    if (toggle) toggle.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Play slideshow');
    trackEl!.setAttribute('aria-live', playing ? 'off' : 'polite');
    syncVideos();
  }

  function go(i: number, byUser = false) {
    index = (i + slides.length) % slides.length;
    programmatic = true;
    trackEl!.scrollTo({ left: slides[index]!.offsetLeft - trackEl!.offsetLeft, behavior: reduced ? 'auto' : 'smooth' });
    window.setTimeout(() => (programmatic = false), 700);
    // Choosing a photo by hand stops autoplay, so the photo stays put while it is being looked at.
    if (byUser) playing = false;
    render();
  }

  root.querySelector('[data-slideshow-prev]')?.addEventListener('click', () => go(index - 1, true));
  root.querySelector('[data-slideshow-next]')?.addEventListener('click', () => go(index + 1, true));
  dots.forEach((d, i) => d.addEventListener('click', () => go(i, true)));
  toggle?.addEventListener('click', () => {
    playing = !playing;
    render();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(index + 1, true);
    else if (e.key === 'ArrowLeft') go(index - 1, true);
  });

  // Swiping or scrolling the row by hand: follow it and stop autoplay.
  let scrollTimer: number | undefined;
  trackEl.addEventListener('scroll', () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      const i = Math.round(trackEl.scrollLeft / trackEl.clientWidth);
      if (i !== index) {
        index = Math.max(0, Math.min(slides.length - 1, i));
        if (!programmatic) playing = false;
        render();
      }
    }, 120);
  });

  root.addEventListener('mouseenter', () => (held = true));
  root.addEventListener('mouseleave', () => (held = false));
  root.addEventListener('focusin', () => (held = true));
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget as Node | null)) held = false;
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      ([entry]) => {
        onScreen = Boolean(entry?.isIntersecting);
        syncVideos();
      },
      { threshold: 0.3 },
    ).observe(root);
  }
  document.addEventListener('visibilitychange', syncVideos);
  window.setInterval(() => {
    if (playing && !held && onScreen && !document.hidden) go(index + 1);
  }, INTERVAL);
  render();
}

document.querySelectorAll<HTMLElement>('[data-slideshow]').forEach(init);
