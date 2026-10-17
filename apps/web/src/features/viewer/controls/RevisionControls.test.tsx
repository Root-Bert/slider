import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerToastContext } from '../state/viewer-toast';
import { RevisionControls, UploadRevisionControl } from './RevisionControls';

type Mutate = (
  file: File,
  callbacks: { onSuccess: (result: unknown) => void; onError: (error: Error) => void },
) => void;

const mocks = vi.hoisted(() => ({
  revision: {
    revisionNumber: 3,
    isLinked: false,
    badges: new Map<string, unknown>(),
    announcement: null as { revisionNumber: number; summary: { text: string } | null } | null,
    dismissAnnouncement: vi.fn(),
  },
  data: { canManage: true, deck: { id: 'd1' } },
  state: { showChanges: true },
  dispatch: vi.fn(),
  upload: { mutate: vi.fn<Mutate>(), isPending: false },
}));

vi.mock('../state/revision-data', () => ({ useRevisionData: () => mocks.revision }));
vi.mock('../state/viewer-data', () => ({ useViewerData: () => mocks.data }));
vi.mock('../state/viewer-state', () => ({
  useViewerState: () => mocks.state,
  useViewerDispatch: () => mocks.dispatch,
}));
vi.mock('@/lib/api', () => ({ useUploadRevision: () => mocks.upload }));
vi.mock('../revisions/RevisionNotice', () => ({
  RevisionNotice: ({ announcement }: { announcement: { revisionNumber: number } }) => (
    <span>Notice V{announcement.revisionNumber}</span>
  ),
}));

describe('RevisionControls', () => {
  beforeEach(() => {
    mocks.revision.revisionNumber = 3;
    mocks.revision.badges = new Map([['s1', {}]]);
    mocks.revision.announcement = null;
    mocks.state.showChanges = true;
    mocks.dispatch.mockReset();
  });

  it('switches the change markers of the latest version', async () => {
    const { rerender } = render(<RevisionControls />);
    const toggle = screen.getByRole('switch', { name: 'Änderungen der Version 3 zeigen' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('title')).toBe('Version 3 – Änderungen ausblenden');
    await userEvent.click(toggle);
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'showChangesSet', show: false });

    mocks.state.showChanges = false;
    rerender(<RevisionControls />);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('title')).toBe('Version 3 – Änderungen zeigen');
    await userEvent.click(toggle);
    expect(mocks.dispatch).toHaveBeenLastCalledWith({ type: 'showChangesSet', show: true });
  });

  it('has no pill for a first version or a version without changes', () => {
    mocks.revision.revisionNumber = 1;
    const { container, rerender } = render(<RevisionControls />);
    expect(screen.queryByRole('switch')).toBeNull();
    // Only the (empty) live region stays mounted.
    expect(container.children).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('');

    mocks.revision.revisionNumber = 2;
    mocks.revision.badges = new Map();
    rerender(<RevisionControls />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('announces a new version and shows its notice next to the switch', () => {
    mocks.revision.announcement = { revisionNumber: 3, summary: { text: '2 Folien geändert' } };
    render(<RevisionControls />);
    expect(screen.getByRole('status').textContent).toBe('V3 geladen · 2 Folien geändert');
    expect(screen.getByText('Notice V3')).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
  });

  it('shows the notice alone when the new version changed nothing to mark', () => {
    mocks.revision.badges = new Map();
    mocks.revision.announcement = { revisionNumber: 3, summary: null };
    render(<RevisionControls />);
    expect(screen.getByText('Notice V3')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('UploadRevisionControl', () => {
  beforeEach(() => {
    mocks.data.canManage = true;
    mocks.revision.isLinked = false;
    mocks.upload.isPending = false;
    mocks.upload.mutate.mockReset();
  });

  const fileInput = (container: HTMLElement) =>
    container.querySelector<HTMLInputElement>('input[type="file"]')!;

  it('is only there for managers of an uploaded deck', () => {
    mocks.data.canManage = false;
    const { container, rerender } = render(<UploadRevisionControl />);
    expect(container.innerHTML).toBe('');

    mocks.data.canManage = true;
    mocks.revision.isLinked = true;
    rerender(<UploadRevisionControl />);
    expect(container.innerHTML).toBe('');

    mocks.revision.isLinked = false;
    rerender(<UploadRevisionControl />);
    expect(screen.getByRole('button', { name: 'Neue Version hochladen (.pptx)' })).toBeTruthy();
  });

  it('uploads the picked file and toasts the result', () => {
    const showToast = vi.fn();
    const { container } = render(
      <ViewerToastContext value={showToast}>
        <UploadRevisionControl />
      </ViewerToastContext>,
    );
    const input = fileInput(container);
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Neue Version hochladen (.pptx)' }));
    expect(click).toHaveBeenCalled();

    const file = new File(['x'], 'deck.pptx');
    fireEvent.change(input, { target: { files: [file] } });
    expect(mocks.upload.mutate).toHaveBeenCalledTimes(1);
    const [uploaded, callbacks] = mocks.upload.mutate.mock.calls[0]!;
    expect(uploaded).toBe(file);

    callbacks.onSuccess({ status: 'unchanged' });
    expect(showToast).toHaveBeenLastCalledWith('Keine Änderungen', 'neutral');
    callbacks.onSuccess({ status: 'updated' });
    expect(showToast).toHaveBeenCalledTimes(1);
    callbacks.onError(new Error('Zu groß'));
    expect(showToast).toHaveBeenLastCalledWith('Zu groß', 'danger');
  });

  it('keeps the focused button while the version is processed, with a spinner over its icon', () => {
    const { rerender, container } = render(<UploadRevisionControl />);
    const button = screen.getByRole('button', { name: 'Neue Version hochladen (.pptx)' });
    button.focus();

    mocks.upload.isPending = true;
    rerender(<UploadRevisionControl />);
    expect(screen.getByRole('button', { name: 'Neue Version wird verarbeitet …' })).toBe(button);
    // Not `disabled` (that would drop the focus to <body>): announced busy and inert instead.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    const click = vi.spyOn(fileInput(container), 'click');
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();

    mocks.upload.isPending = false;
    rerender(<UploadRevisionControl />);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });
});
