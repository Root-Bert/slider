/*
 * Section choreography (Figma spec "motion & patterns"): every `[data-section]` plays its entrance
 * once when it scrolls into view; the hero plays on load. CSS in site.css does the animating –
 * this only adds `.is-in`. `.js` is set inline in the head, before the first paint.
 */
declare global {
  interface Window {
    __sliderMotion?: boolean;
  }
}

window.__sliderMotion = true;
document.documentElement.classList.add('js');

/** Two frames later: the hidden start state has been painted, so the transition really runs. */
const reveal = (el: Element) =>
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
const sections = document.querySelectorAll('[data-section]');

if (!('IntersectionObserver' in window)) {
  sections.forEach(reveal);
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -15% 0px' },
  );
  sections.forEach((section) => observer.observe(section));
}

export {};
