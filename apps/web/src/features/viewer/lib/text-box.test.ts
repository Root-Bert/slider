import { describe, expect, it } from 'vitest';
import type { Draft, TextBoxDraft } from '../state/viewer-state';
import {
  clickTextBox,
  draftSubmission,
  dragTextBox,
  normalizeTextRect,
  startFontSize,
  textStrokeFromDraft,
} from './text-box';

const textBox = (overrides: Partial<TextBoxDraft> = {}): TextBoxDraft => ({
  x: 0.1,
  y: 0.2,
  width: null,
  minHeight: 0,
  fontSize: 0.04,
  text: 'Logo größer',
  measured: { x: 0.1, y: 0.2, w: 0.25, h: 0.08 },
  ...overrides,
});

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  slideId: 's1',
  anchor: { type: 'rect', rect: { x: 0.1, y: 0.2, w: 0.25, h: 0.08 }, shapeRef: null },
  anchorFromStrokes: false,
  strokes: [],
  undone: [],
  textBox: textBox(),
  ...overrides,
});

describe('text box sizes', () => {
  it('starts at about 16px on the current slide, within sensible bounds', () => {
    expect(startFontSize(400)).toBe(0.04);
    expect(startFontSize(100)).toBe(0.08);
    expect(startFontSize(2000)).toBe(0.025);
    expect(startFontSize(0)).toBe(0.04);
  });

  it('opens a growing box at a click, nudged in from the edges', () => {
    expect(clickTextBox({ x: 0.3, y: 0.4 }, 0.04)).toEqual({
      x: 0.3,
      y: 0.4,
      width: null,
      minHeight: 0,
      fontSize: 0.04,
    });
    const corner = clickTextBox({ x: 0.99, y: 0.99 }, 0.05);
    expect(corner.x).toBeCloseTo(0.88);
    expect(corner.y).toBeCloseTo(0.92);
  });

  it('opens a dragged box with its width and height', () => {
    expect(dragTextBox({ x: 0.2, y: 0.3, w: 0.3, h: 0.1 }, 0.04)).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.3,
      minHeight: 0.1,
      fontSize: 0.04,
    });
    expect(dragTextBox({ x: 0.2, y: 0.3, w: 0.001, h: 0 }, 0.04).width).toBe(0.04);
  });

  it('keeps measured boxes on the slide', () => {
    expect(normalizeTextRect({ x: 0.8, y: 0.95, w: 0.4, h: 0.1 })).toEqual({
      x: 0.8,
      y: 0.95,
      w: 0.2,
      h: 0.05,
    });
  });
});

describe('sending a text box', () => {
  it('turns the box into a text annotation in the author colour', () => {
    expect(textStrokeFromDraft(textBox({ text: '  Hallo\nWelt ' }), 'blue')).toEqual({
      tool: 'text',
      color: 'blue',
      x: 0.1,
      y: 0.2,
      w: 0.25,
      h: 0.08,
      text: 'Hallo\nWelt',
      fontSize: 0.04,
    });
    expect(textStrokeFromDraft(textBox({ text: '   ' }), 'blue')).toBeNull();
  });

  it('sends the text as body, anchored at the box, next to other drawings', () => {
    const pen = {
      tool: 'pen' as const,
      color: 'red' as const,
      points: [
        { x: 0.5, y: 0.5 },
        { x: 0.6, y: 0.6 },
      ],
    };
    const submission = draftSubmission(draft({ strokes: [pen] }), 'ignored', 'red');
    expect(submission?.body).toBe('Logo größer');
    expect(submission?.anchor).toEqual({
      type: 'rect',
      rect: { x: 0.1, y: 0.2, w: 0.25, h: 0.08 },
      shapeRef: null,
    });
    expect(submission?.strokes.map((stroke) => stroke.tool)).toEqual(['pen', 'text']);
  });

  it('drops an empty box: drawings alone are anchored at their bounds', () => {
    const pen = {
      tool: 'pen' as const,
      color: 'red' as const,
      points: [
        { x: 0.5, y: 0.5 },
        { x: 0.6, y: 0.7 },
      ],
    };
    expect(draftSubmission(draft({ textBox: textBox({ text: '' }) }), '', 'red')).toBeNull();
    const submission = draftSubmission(
      draft({ strokes: [pen], textBox: textBox({ text: ' ' }) }),
      '',
      'red',
    );
    expect(submission?.anchor).toMatchObject({ type: 'rect', rect: { x: 0.5, y: 0.5 } });
    expect(submission?.strokes).toEqual([pen]);
  });

  it('sends other drafts unchanged, with the composer text as body', () => {
    const plain = draft({ textBox: null });
    expect(draftSubmission(plain, '  Hallo ', 'red')).toEqual({
      body: 'Hallo',
      anchor: plain.anchor,
      strokes: [],
    });
    expect(draftSubmission(plain, ' ', 'red')).toBeNull();
  });
});
