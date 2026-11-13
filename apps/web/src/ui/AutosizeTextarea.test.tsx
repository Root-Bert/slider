import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AutosizeTextarea } from './AutosizeTextarea';

it('reuses fitting border-box measurements and preserves capped and content-box sizing', () => {
  let natural = 36;
  let final = 36;
  const scrollHeight = vi
    .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
    .mockImplementation(function (this: HTMLTextAreaElement) {
      return this.style.height === 'auto' ? natural : final;
    });
  try {
    const { container, rerender } = render(
      <AutosizeTextarea value="short" maxHeight={120} style={{ boxSizing: 'border-box' }} />,
    );
    const field = container.querySelector('textarea')!;
    expect([field.style.height, field.style.overflowY]).toEqual(['36px', 'hidden']);
    expect(scrollHeight).toHaveBeenCalledTimes(1);

    scrollHeight.mockClear();
    rerender(
      <AutosizeTextarea value="short" maxHeight={120} style={{ boxSizing: 'border-box' }} />,
    );
    expect(scrollHeight).not.toHaveBeenCalled();

    natural = final = 180;
    scrollHeight.mockClear();
    rerender(<AutosizeTextarea value="long" maxHeight={120} style={{ boxSizing: 'border-box' }} />);
    expect([field.style.height, field.style.overflowY]).toEqual(['120px', 'auto']);
    expect(scrollHeight).toHaveBeenCalledTimes(2);

    // The natural height can include unused rows: after capping, it can fit again.
    final = 38;
    rerender(
      <AutosizeTextarea value="short again" maxHeight={40} style={{ boxSizing: 'border-box' }} />,
    );
    expect([field.style.height, field.style.overflowY]).toEqual(['40px', 'hidden']);

    natural = final = 36;
    scrollHeight.mockClear();
    rerender(
      <AutosizeTextarea value="shrunk" maxHeight={120} style={{ boxSizing: 'border-box' }} />,
    );
    expect([field.style.height, field.style.overflowY]).toEqual(['36px', 'hidden']);
    expect(scrollHeight).toHaveBeenCalledTimes(1);

    // Content-box padding can make the final scroll height exceed the natural one.
    final = 48;
    scrollHeight.mockClear();
    rerender(
      <AutosizeTextarea value="padded" maxHeight={40} style={{ boxSizing: 'content-box' }} />,
    );
    expect([field.style.height, field.style.overflowY]).toEqual(['36px', 'auto']);
    expect(scrollHeight).toHaveBeenCalledTimes(2);
  } finally {
    vi.restoreAllMocks();
  }
});
