import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TextBoxDraft } from '../state/viewer-state';
import { TextBoxField } from './TextBox';

const box = (overrides: Partial<TextBoxDraft> = {}): TextBoxDraft => ({
  x: 0.1,
  y: 0.2,
  width: null,
  minHeight: 0,
  fontSize: 0.04,
  text: 'Hallo',
  measured: null,
  ...overrides,
});

function renderField(props: Partial<ComponentProps<typeof TextBoxField>> = {}) {
  const handlers = {
    onChange: vi.fn(),
    onMeasured: vi.fn(),
    onLeave: vi.fn(() => true),
  };
  render(
    <TextBoxField
      box={box()}
      author={{ name: 'Anna Berg', color: 'violet' }}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, field: screen.getByRole('textbox', { name: 'Text auf der Folie' }) };
}

describe('TextBoxField', () => {
  it('opens focused, with the caret after the text', () => {
    const { field } = renderField();
    const textarea = field as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe('Hallo'.length);
  });

  it('reports typed text', async () => {
    const { field, onChange } = renderField({ box: box({ text: '' }) });
    await userEvent.type(field, 'A');
    expect(onChange).toHaveBeenLastCalledWith({ text: 'A' });
  });

  it('goes on to the comment with ↵ and Tab, but keeps ⇧↵ as a new line', () => {
    const { field, onLeave } = renderField();
    const enter = fireEvent.keyDown(field, { key: 'Enter' });
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(enter).toBe(false); // default prevented: no line break
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(onLeave).toHaveBeenCalledTimes(2);
    const newLine = fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onLeave).toHaveBeenCalledTimes(2);
    expect(newLine).toBe(true);
  });

  it('lets ↵ through when there is nothing to go on to', () => {
    const { field } = renderField({ onLeave: () => false });
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(true);
  });

  it('sends through the composer with ⌘↵ / Ctrl↵', () => {
    const form = document.createElement('form');
    form.setAttribute('data-composer', '');
    const requestSubmit = vi.fn();
    form.requestSubmit = requestSubmit;
    document.body.append(form);
    try {
      const { field, onLeave } = renderField();
      fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
      fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
      expect(requestSubmit).toHaveBeenCalledTimes(2);
      expect(onLeave).not.toHaveBeenCalled();
    } finally {
      form.remove();
    }
  });

  it('handles Esc itself only when asked to, without letting it reach the viewer', () => {
    const onEscape = vi.fn();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      const { field } = renderField({ onEscape });
      fireEvent.keyDown(field, { key: 'Escape' });
      expect(onEscape).toHaveBeenCalledOnce();
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('leaves Esc to the viewer without an own handler', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      const { field } = renderField();
      fireEvent.keyDown(field, { key: 'Escape' });
      expect(onWindowKey).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('shows the author’s first name on the move tag', () => {
    renderField();
    expect(screen.getByText('Anna').getAttribute('title')).toBe('Textfeld verschieben');
    expect(screen.getAllByTitle('Größe ändern')).toHaveLength(4);
  });
});
