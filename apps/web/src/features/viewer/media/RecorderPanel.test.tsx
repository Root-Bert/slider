import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderState, Recording } from './hooks/useRecorder';
import type * as RecordingModule from './lib/recording';
import { RecorderPanel } from './RecorderPanel';

const recorder = {
  state: { status: 'idle' } as RecorderState,
  stream: null as MediaStream | null,
  levels: [] as number[],
  elapsedMs: 0,
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  reset: vi.fn(),
};
let usage: { usedBytes: number; limitBytes: number | null } | undefined;
let screenSupported = true;

vi.mock('./hooks/useRecorder', () => ({ useRecorder: () => recorder }));
vi.mock('./hooks/useMediaComment', () => ({ useMediaUsage: () => ({ data: usage }) }));
vi.mock('./lib/recording', async (importOriginal) => ({
  ...(await importOriginal<typeof RecordingModule>()),
  canShareScreen: () => screenSupported,
}));

const audioRecording: Recording = {
  kind: 'audio',
  blob: new Blob(['x'.repeat(2048)]),
  url: 'blob:recording',
  mimeType: 'audio/webm',
  durationMs: 12_000,
  peaks: [0.2, 0.8],
};

const renderPanel = (props: Partial<Parameters<typeof RecorderPanel>[0]> = {}) => {
  const onChange = vi.fn();
  const view = render(<RecorderPanel kind="audio" deckId="d1" onChange={onChange} {...props} />);
  return { ...view, onChange, panel: screen.getByRole('group', { name: /Sprachkommentar|Video/ }) };
};

beforeEach(() => {
  recorder.state = { status: 'idle' };
  recorder.elapsedMs = 0;
  usage = undefined;
  screenSupported = true;
  for (const fn of [recorder.start, recorder.stop, recorder.pause, recorder.resume, recorder.reset])
    fn.mockClear();
});

describe('RecorderPanel', () => {
  it('starts with the record button and Space on the panel', async () => {
    const { panel } = renderPanel({ autoFocus: true });
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: ' ' });
    expect(recorder.start).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /Aufnahme starten/ }));
    expect(recorder.start).toHaveBeenCalledTimes(2);
  });

  it('shows the requesting state as a disabled button', () => {
    recorder.state = { status: 'requesting' };
    renderPanel();
    const button = screen.getByRole('button', { name: /Zugriff auf Mikrofon/ });
    expect(button).toHaveProperty('disabled', true);
  });

  it('pauses, resumes and stops while recording', async () => {
    recorder.state = { status: 'recording' };
    recorder.elapsedMs = 280_000;
    const { panel } = renderPanel();
    const stop = screen.getByRole('button', { name: 'Aufnahme beenden' });
    expect(stop.getAttribute('title')).toBe('Aufnahme beenden (↵)');
    // Under 30 seconds left: the time turns into a warning.
    expect(screen.getByTitle('Höchstens 5 Minuten').className).toContain('text-warning');

    await userEvent.click(screen.getByRole('button', { name: 'Aufnahme pausieren' }));
    expect(recorder.pause).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(panel, { key: ' ' });
    expect(recorder.pause).toHaveBeenCalledTimes(2);
    // The keys also work on the stop button (it keeps the focus while recording).
    fireEvent.keyDown(stop, { key: 'Enter' });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    await userEvent.click(stop);
    expect(recorder.stop).toHaveBeenCalledTimes(2);
  });

  it('resumes a paused recording', async () => {
    recorder.state = { status: 'paused' };
    const { panel } = renderPanel();
    fireEvent.keyDown(panel, { key: ' ' });
    expect(recorder.resume).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Aufnahme fortsetzen' }));
    expect(recorder.resume).toHaveBeenCalledTimes(2);
  });

  it('leaves keys on other controls alone', () => {
    recorder.state = { status: 'recording' };
    renderPanel();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Aufnahme pausieren' }), { key: ' ' });
    expect(recorder.pause).not.toHaveBeenCalled();
  });

  it('hands Tab to the composer', () => {
    const onTab = vi.fn();
    const { panel } = renderPanel({ onTab });
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(onTab).toHaveBeenCalledWith(true);
  });

  it('reports a finished recording and offers to record again', async () => {
    recorder.state = { status: 'recorded', recording: audioRecording };
    const { onChange } = renderPanel();
    expect(onChange).toHaveBeenCalledWith(audioRecording);
    expect(screen.getByRole('slider', { name: 'Position in der Aufnahme' })).toBeTruthy();
    expect(screen.getByText(/0:12 ·/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Neu aufnehmen' }));
    expect(recorder.reset).toHaveBeenCalled();
  });

  it('shows an error with a retry', async () => {
    recorder.state = { status: 'error', message: 'Kein Mikrofon gefunden.' };
    renderPanel();
    expect(screen.getByRole('alert').textContent).toBe('Kein Mikrofon gefunden.');
    await userEvent.click(screen.getByRole('button', { name: 'Erneut' }));
    expect(recorder.reset).toHaveBeenCalled();
  });

  it('warns when the storage is nearly full', () => {
    usage = { usedBytes: 950, limitBytes: 1000 };
    renderPanel();
    const hint = screen.getByText(/Max\. 5 Min\./);
    expect(hint.textContent).toMatch(/belegt\.$/);
    expect(hint.className).toContain('text-warning');
  });

  it('picks the video source, screen sources off without screen sharing', async () => {
    screenSupported = false;
    render(<RecorderPanel kind="video" deckId="d1" onChange={vi.fn()} />);
    const sources = screen.getByRole('radiogroup', { name: 'Bildquelle' });
    expect(sources).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Bildschirm/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('radio', { name: /Kamera/ }).getAttribute('aria-checked')).toBe('true');
  });
});
