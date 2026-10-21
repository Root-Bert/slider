import { describe, expect, it } from 'vitest';
import { needsRemeasure } from './useConnectorLayout';

function scroller() {
  const root = document.createElement('div');
  root.innerHTML = `
    <nav data-minimap data-connector-ignore><div data-minimap-bracket></div><span>3</span></nav>
    <div data-comment-area><div data-card></div></div>
    <svg data-layer><path></path></svg>`;
  const get = (selector: string) => root.querySelector(selector)!;
  return { root, get };
}

describe('needsRemeasure', () => {
  it('ignores the minimap bracket moving with a sideways scroll, and the lines themselves', () => {
    const { get } = scroller();
    const layer = get('[data-layer]');
    expect(needsRemeasure([{ target: get('[data-minimap-bracket]') }], layer)).toBe(false);
    expect(needsRemeasure([{ target: get('nav span').firstChild! }], layer)).toBe(false);
    expect(needsRemeasure([{ target: get('path') }], layer)).toBe(false);
  });

  it('re-measures when a card or the comment area changes', () => {
    const { get } = scroller();
    const layer = get('[data-layer]');
    expect(
      needsRemeasure(
        [{ target: get('[data-minimap-bracket]') }, { target: get('[data-card]') }],
        layer,
      ),
    ).toBe(true);
    expect(needsRemeasure([{ target: get('[data-comment-area]') }], null)).toBe(true);
  });
});
