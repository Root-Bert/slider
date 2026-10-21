/** Stars spread by a fixed seed: the same sky on every visit, no list of 60 coordinates here. */
export function stars(count: number, width: number, height: number, seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(next() * width),
    y: Math.round(next() * height),
    r: next() > 0.8 ? 1.1 : 0.7,
    /** Every fourth star twinkles, each on its own beat. */
    twinkle: index % 4 === 0 ? -next() * 5 : null,
  }));
}
