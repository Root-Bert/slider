/*
 * Objects lean towards the pointer: `[data-tilt]` gets `--tx`/`--ty` (degrees, at most ±6) from
 * where the pointer is over the window, eased in CSS (`.object-stage`). Fine pointers only, and
 * not with reduced motion.
 */
const MAX = 6;
const still = matchMedia('(prefers-reduced-motion: reduce)');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const objects = [...document.querySelectorAll<HTMLElement>('[data-tilt]')];
let frame = 0;
let x = 0;
let y = 0;

function apply(): void {
  frame = 0;
  for (const object of objects) {
    const box = object.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) continue;
    const dx = (x - (box.left + box.width / 2)) / innerWidth;
    const dy = (y - (box.top + box.height / 2)) / innerHeight;
    object.style.setProperty('--tx', (Math.max(-1, Math.min(1, dx * 2)) * MAX).toFixed(2));
    object.style.setProperty('--ty', (Math.max(-1, Math.min(1, dy * 2)) * -MAX).toFixed(2));
    // Where the light falls, as a share of the object's box.
    object.style.setProperty('--lx', `${(((x - box.left) / box.width) * 100).toFixed(1)}%`);
    object.style.setProperty('--ly', `${(((y - box.top) / box.height) * 100).toFixed(1)}%`);
  }
}

if (objects.length > 0) {
  addEventListener(
    'pointermove',
    (event) => {
      if (still.matches || !fine.matches) return;
      x = event.clientX;
      y = event.clientY;
      frame ||= requestAnimationFrame(apply);
    },
    { passive: true },
  );
}

export {};
