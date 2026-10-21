/**
 * Fixed-size product shots (`.stage-wrap > .stage`, drawn at their Figma size) scale down with
 * their column: the wrapper's width over the stage's own width, never above 1.
 */
export function fitStages(): void {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const wrap = entry.target as HTMLElement;
      const stage = wrap.querySelector<HTMLElement>(':scope > .stage');
      if (!stage) continue;
      const scale = Math.min(1, entry.contentRect.width / stage.offsetWidth);
      wrap.style.setProperty('--stage-scale', String(scale));
    }
  });
  document.querySelectorAll('.stage-wrap').forEach((wrap) => observer.observe(wrap));
}
