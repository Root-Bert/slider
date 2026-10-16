import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './MediaPlayer';
import { Waveform } from './Waveform';

describe('Waveform', () => {
  it('is only a slider when it can seek', () => {
    const { container, rerender } = render(<Waveform peaks={[0.5, 1]} label="Position" />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(container.querySelectorAll('span[aria-hidden]')).toHaveLength(2);

    rerender(<Waveform peaks={[]} progress={0.5} onSeek={vi.fn()} label="Position" />);
    const slider = screen.getByRole('slider', { name: 'Position' });
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
    expect(slider.tabIndex).toBe(0);
    // No peaks: an even line of 32 bars.
    expect(container.querySelectorAll('span[aria-hidden]')).toHaveLength(32);
  });

  it('seeks with the arrow keys in 5 % steps, clamped', () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <Waveform peaks={[1]} progress={0.98} onSeek={onSeek} label="Position" />,
    );
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(1);
    rerender(<Waveform peaks={[1]} progress={0.02} onSeek={onSeek} label="Position" />);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onSeek).toHaveBeenCalledTimes(2);
  });

  it('seeks to the pointer position', () => {
    const onSeek = vi.fn();
    render(<Waveform peaks={[1]} onSeek={onSeek} label="Position" />);
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;
    fireEvent.pointerDown(slider, { clientX: 150 });
    expect(onSeek).toHaveBeenCalledWith(0.25);
  });
});

describe('AudioPlayer', () => {
  it('plays and pauses, showing the stored duration', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(async function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'));
      });
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event('pause'));
      });
    const { container } = render(<AudioPlayer src="blob:a" durationMs={65_000} peaks={[0.4]} />);
    expect(container.textContent).toContain('1:05');

    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => true });
    await userEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(play).toHaveBeenCalled();

    const pauseButton = screen.getByRole('button', { name: 'Pause' });
    // No native tooltip on the play button.
    expect(pauseButton.hasAttribute('title')).toBe(false);
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false });
    await userEvent.click(pauseButton);
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Abspielen' })).toBeTruthy();

    play.mockRestore();
    pause.mockRestore();
  });

  it('seeks within the recording', () => {
    const { container } = render(<AudioPlayer src="blob:a" durationMs={10_000} peaks={[0.4]} />);
    const slider = screen.getByRole('slider', { name: 'Position in der Aufnahme' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(container.querySelector('audio')!.currentTime).toBeCloseTo(0.5);
    expect(slider.getAttribute('aria-valuenow')).toBe('5');
    expect(container.textContent).toContain('0:00');
  });
});
