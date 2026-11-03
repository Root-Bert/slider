import { describe, expect, it, vi } from 'vitest';
import { createPreviewStore } from './preview-store';

describe('drag preview ownership', () => {
  it('ignores late cleanup from another element or from the surface left by a mode switch', () => {
    const store = createPreviewStore();
    const preview = { elementId: 'new', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } };
    store.set(preview);
    const changed = vi.fn();
    store.subscribe(changed);
    store.set(null, 'old');
    expect(store.get()).toBe(preview);
    expect(changed).not.toHaveBeenCalled();
    store.set(null, 'new');
    expect(store.get()).toBeNull();
    expect(changed).toHaveBeenCalledOnce();

    const flat = {},
      layers = {};
    const same = { elementId: 'same', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } };
    store.set(same, 'same', flat);
    const next = { ...same, rect: { ...same.rect, x: 0.5 } };
    store.set(next, 'same', layers);
    store.set(null, 'same', flat);
    expect(store.get()).toBe(next);
    store.set(null, 'same', layers);
    expect(store.get()).toBeNull();
  });
});
