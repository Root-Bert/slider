import { LogoMark } from '@/ui';
import solverMark from '../assets/solver-mark.svg';
import writerMark from '../assets/writer-mark.svg';
import { CloudMark, ReaderMark, SenderMark } from './AppSwitcher';

/** Every app of the account – those that are there, and the one to come. */
export type AppName = 'cloud' | 'slider' | 'writer' | 'reader' | 'sender' | 'solver';

/** An app's mark, `width` px wide – wherever a setting or a row says which app it is for. */
export function AppMark({ app, width = 18 }: { app: AppName; width?: number }) {
  if (app === 'slider') return <LogoMark width={width} />;
  if (app === 'cloud') return <CloudMark width={width} />;
  if (app === 'reader') return <ReaderMark width={width} />;
  if (app === 'sender') return <SenderMark width={width} />;
  return (
    <img
      src={app === 'writer' ? writerMark : solverMark}
      alt=""
      width={width}
      height={(width * 89) / 96}
      draggable={false}
    />
  );
}

const NAMES: Record<AppName, string> = {
  cloud: 'Cloud',
  slider: 'Slider',
  writer: 'Writer',
  reader: 'Reader',
  sender: 'Sender',
  solver: 'Solver',
};

/** „Slider“ with its mark: the sign at a section's head that what stands there is one app's. */
export function AppTag({ app }: { app: AppName }) {
  return (
    <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-chip bg-surface-2 px-2 text-xs font-medium text-fg-muted">
      <AppMark app={app} width={14} />
      {NAMES[app]}
    </span>
  );
}
