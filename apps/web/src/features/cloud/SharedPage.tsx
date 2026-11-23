import { useState } from 'react';
import { ViewSearch } from '@/features/workspaces';
import { GlassPanel, SegmentedControl } from '@/ui';
import { AcrossPage } from './components/AcrossPage';

const TABS = [
  { value: 'shared', label: 'Mit mir geteilt' },
  { value: 'sharedByMe', label: 'Von mir geteilt' },
] as const;

/** „Geteilt“: what others gave the caller – and what the caller gave others. */
export function Component() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('shared');
  const [query, setQuery] = useState('');
  return (
    <AcrossPage
      key={tab}
      scope={tab}
      title="Geteilt"
      query={query}
      search={<ViewSearch label="Geteiltes durchsuchen" value={query} onChange={setQuery} />}
      lead={
        <GlassPanel className="shrink-0 p-1">
          <SegmentedControl
            label="Welche Freigaben"
            mode="tabs"
            segments={TABS}
            value={tab}
            onChange={setTab}
          />
        </GlassPanel>
      }
      empty={
        tab === 'shared'
          ? {
              icon: 'folderShared',
              title: 'Noch nichts mit dir geteilt',
              message: 'Was jemand aus dem Workspace für dich öffnet, liegt hier.',
            }
          : {
              icon: 'share',
              title: 'Du hast noch nichts geteilt',
              message: 'Was du für einzelne Personen öffnest, liegt hier.',
            }
      }
    />
  );
}
