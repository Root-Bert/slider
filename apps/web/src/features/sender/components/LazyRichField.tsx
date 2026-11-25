import {
  lazy,
  Suspense,
  useCallback,
  useImperativeHandle,
  useRef,
  type ComponentProps,
} from 'react';
import { cn } from '@/ui';
import type { RichField as Field, RichFieldHandle } from './RichField';

/*
 * `RichField` loaded on its own: Lexical stays out of the app's first chunk (the AI's side panel
 * holds a message field everywhere). Fetched as soon as this module is, so the field is there by
 * the time one types; until then its text stands where it will be, and a focus asked for meanwhile
 * (a field opened to be written in) comes when it is there.
 */

const load = () => import('./RichField');
void load();
const Lazy = lazy(() => load().then((module) => ({ default: module.RichField })));

export function RichField({ ref, ...props }: ComponentProps<typeof Field>) {
  const inner = useRef<RichFieldHandle | null>(null);
  const focusWhenThere = useRef(false);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (inner.current) inner.current.focus();
        else focusWhenThere.current = true;
      },
      replaceMention: (name) => inner.current?.replaceMention(name) ?? false,
      insertMentionSign: () => inner.current?.insertMentionSign(),
      replaceAll: (text) => inner.current?.replaceAll(text),
      inList: () => inner.current?.inList() ?? false,
    }),
    [],
  );
  const attach = useCallback((handle: RichFieldHandle | null) => {
    inner.current = handle;
    if (handle && focusWhenThere.current) {
      focusWhenThere.current = false;
      handle.focus();
    }
  }, []);
  return (
    <Suspense
      fallback={
        <div
          className={cn(
            'relative min-w-0 break-words whitespace-pre-wrap',
            !props.value && 'text-fg-subtle',
            props.className,
          )}
        >
          {props.value || props.placeholder}
        </div>
      }
    >
      <Lazy {...props} ref={attach} />
    </Suspense>
  );
}
