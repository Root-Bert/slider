import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MentionTextarea } from './MentionTextarea';

vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({ participantNames: ['Anna Becker', 'kim@example.com'] }),
}));

const highlights = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-mention]')].map((element) => element.textContent);

describe('MentionTextarea', () => {
  it('tints the mentions of people in the deck behind the text', () => {
    const { container } = render(
      <MentionTextarea
        aria-label="Kommentar"
        value="@Anna Becker und @kim@example.com **schauen**, @Fremd nicht"
        onChange={() => {}}
      />,
    );
    expect(highlights(container)).toEqual(['@Anna Becker', '@kim@example.com']);
    // The backdrop holds the same text as the field, so the tints line up.
    expect(container.querySelector('[aria-hidden]')?.textContent).toBe(
      (screen.getByRole('textbox') as HTMLTextAreaElement).value,
    );
  });

  it('adds no backdrop while nobody is mentioned', () => {
    const { container } = render(
      <MentionTextarea aria-label="Kommentar" value="@Ann" onChange={() => {}} />,
    );
    expect(container.querySelector('[aria-hidden]')).toBeNull();
  });
});
