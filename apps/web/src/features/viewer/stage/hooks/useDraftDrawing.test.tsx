import type { Comment, CreateCommentInput } from '@slider/shared';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PointerEvent, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comment, slide } from '../../lib/test-fixtures';
import { useDraftDrawing } from './useDraftDrawing';

interface Pending {
  input: CreateCommentInput;
  resolve: (comment: Comment) => void;
  reject: (error: Error) => void;
}
let requests: Pending[] = [];
const dispatch = vi.fn();
const showToast = vi.fn();

vi.mock('@/lib/api', () => ({
  useCreateComment: () =>
    useMutation({
      mutationFn: (input: CreateCommentInput) =>
        new Promise<Comment>((resolve, reject) => requests.push({ input, resolve, reject })),
    }),
}));
vi.mock('../../state/viewer-data', () => ({ useViewerData: () => ({ deck: { id: 'd1' } }) }));
vi.mock('../../state/viewer-state', () => ({ useViewerDispatch: () => dispatch }));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => showToast }));

const box = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
} as HTMLElement;

const pointer = (x: number, y: number) =>
  ({
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    preventDefault: () => undefined,
    currentTarget: { setPointerCapture: () => undefined },
  }) as unknown as PointerEvent<HTMLElement>;

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useDraftDrawing({
        slide: slide('s1', 0),
        boxRef: { current: box },
        tool: 'pen',
        color: 'red',
      }),
    { wrapper },
  );
  const draw = (from: number, to: number) => {
    act(() => view.result.current.handlers.onPointerDown(pointer(from, 10)));
    act(() => view.result.current.handlers.onPointerMove(pointer(to, 40)));
    act(() => view.result.current.handlers.onPointerUp());
  };
  return { view, draw };
}

beforeEach(() => {
  requests = [];
  dispatch.mockClear();
  showToast.mockClear();
});

describe('useDraftDrawing', () => {
  it('drops the preview of every stroke once stored, also when drawn in quick succession', async () => {
    const { view, draw } = setup();
    draw(10, 30);
    draw(50, 70);
    expect(view.result.current.previewStrokes).toHaveLength(2);
    await waitFor(() => expect(requests).toHaveLength(2));

    // The second one is stored first, then the first.
    await act(async () => requests[1]!.resolve(comment({ id: 'c2' })));
    await act(async () => requests[0]!.resolve(comment({ id: 'c1' })));

    expect(view.result.current.previewStrokes).toHaveLength(0);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'c1' }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'c2' }));
  });

  it('says so when a stroke could not be stored', async () => {
    const { view, draw } = setup();
    draw(10, 30);
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0]!.reject(new Error('Keine Verbindung zum Server.')));
    expect(view.result.current.previewStrokes).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith('Keine Verbindung zum Server.', 'danger');
  });
});
