/**
 * The picture a new frame holds before it gets one (`addImage` without an image): grey, a
 * landscape glyph in its middle – drawn in the frame's proportions, so it is never stretched.
 */
export function placeholderPicture(width: number, height: number): Uint8Array {
  // Hundredths of the frame's size: the glyph a third of its shorter side.
  const w = Math.max(1, Math.round(width * 100));
  const h = Math.max(1, Math.round(height * 100));
  const s = Math.min(w, h) / 3;
  const x = (w - s) / 2;
  const y = (h - s * 0.8) / 2;
  const n = (value: number) => Number(value.toFixed(1));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#e5e7eb"/>` +
    `<circle cx="${n(x + s * 0.72)}" cy="${n(y + s * 0.2)}" r="${n(s * 0.1)}" fill="#9ca3af"/>` +
    `<path d="M${n(x)} ${n(y + s * 0.8)} L${n(x + s * 0.32)} ${n(y + s * 0.32)} ` +
    `L${n(x + s * 0.56)} ${n(y + s * 0.62)} L${n(x + s * 0.7)} ${n(y + s * 0.46)} ` +
    `L${n(x + s)} ${n(y + s * 0.8)} Z" fill="#9ca3af"/>` +
    `</svg>`;
  return new TextEncoder().encode(svg);
}
