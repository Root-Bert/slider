import { act, fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SwapImage } from './SwapImage';

it('keeps the initial preview until decode and two frames, then preserves ordinary replacements', async () => {
  let frames: FrameRequestCallback[] = [];
  const frame = async () => {
    await act(async () => {
      const pending = frames;
      frames = [];
      pending.forEach((callback) => callback(0));
    });
  };
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  let decoded!: () => void;
  const pendingDecode = new Promise<void>((resolve) => {
    decoded = resolve;
  });
  const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    return this.src.endsWith('/full.webp') ? pendingDecode : Promise.resolve();
  });
  const onError = vi.fn();
  try {
    const { container, rerender, unmount } = render(
      <SwapImage src="/full.webp" initialSrc="/thumb.webp" onError={onError} />,
    );
    // Full picture below the preview; the existing cached preview can paint immediately.
    const [full, thumb] = [...container.querySelectorAll('img')];
    expect([full!.getAttribute('src'), thumb!.getAttribute('src')]).toEqual([
      '/full.webp',
      '/thumb.webp',
    ]);
    fireEvent.load(full!);
    await frame();
    await frame();
    expect(container.querySelectorAll('img')).toHaveLength(2);
    await act(async () => {
      decoded();
    });
    await frame();
    expect(container.querySelectorAll('img')).toHaveLength(2);
    await frame();
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')).toBe(full);

    rerender(<SwapImage src="/edited.webp" initialSrc="/thumb.webp" onError={onError} />);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.querySelector('img:last-child')).toBe(full);
    expect(container.querySelector('img[src="/thumb.webp"]')).toBeNull();
    const edited = container.querySelector<HTMLImageElement>('img[src="/edited.webp"]')!;
    await act(async () => {
      fireEvent.load(edited);
    });
    await frame();
    expect(container.querySelector('img:last-child')).toBe(full);
    await frame();
    expect(container.querySelector('img')).toBe(edited);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(decode).toHaveBeenCalledTimes(2);
    unmount();

    const failed = render(
      <SwapImage src="/next.webp" initialSrc="/missing.webp" onError={onError} />,
    );
    fireEvent.error(failed.container.querySelector('img[src="/missing.webp"]')!);
    expect(failed.container.querySelectorAll('img')).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
    fireEvent.error(failed.container.querySelector('img')!);
    expect(onError).toHaveBeenCalledWith('/next.webp');
    failed.unmount();

    const single = render(<SwapImage src="/same.webp" initialSrc="/same.webp" />);
    expect(single.container.querySelectorAll('img')).toHaveLength(1);
    // Back to the one on screen before the next came in: it alone, once.
    single.rerender(<SwapImage src="/other.webp" />);
    expect(single.container.querySelectorAll('img')).toHaveLength(2);
    single.rerender(<SwapImage src="/same.webp" />);
    expect(
      [...single.container.querySelectorAll('img')].map((img) => img.getAttribute('src')),
    ).toEqual(['/same.webp']);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
