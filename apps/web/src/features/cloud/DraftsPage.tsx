import { useState } from 'react';
import {
  DRAFT_KINDS,
  DraftList,
  draftsOf,
  useWorkspaceDrafts,
  type DraftKind,
} from '@/features/sender';
import { ViewSearch } from '@/features/workspaces';
import { GlassPanel, SegmentedControl } from '@/ui';
import { CloudPage } from './components/CloudPage';
import { ListToolbar } from './components/ListToolbar';
import { useStoredChoice } from './hooks/useStoredChoice';

const DRAFT_VIEWS = ['list', 'tiles'] as const;

/**
 * Cloud's „Entwürfe“: what was written and not sent – in a conversation, to an agent, as a mail –,
 * as in Sender. Over it as over „Geteilt“: what kind on the left, the search, rows or tiles right.
 */
export function Component() {
  const all = useWorkspaceDrafts();
  const [kind, setKind] = useState<DraftKind>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useStoredChoice('slider.cloud.drafts-view', DRAFT_VIEWS, 'list');
  const segments = DRAFT_KINDS.map((each) => ({
    ...each,
    count: draftsOf(all, each.value, '').length,
  }));
  return (
    <CloudPage
      docTitle="Entwürfe"
      title="Entwürfe"
      crumbs={[{ label: 'Entwürfe' }]}
      nodes={[]}
      toolbar={
        all.length > 0 && (
          <ListToolbar
            lead={
              <GlassPanel className="shrink-0 p-1">
                <SegmentedControl
                  label="Nach Art filtern"
                  segments={segments}
                  value={kind}
                  onChange={setKind}
                />
              </GlassPanel>
            }
            search={<ViewSearch label="Entwürfe durchsuchen" value={query} onChange={setQuery} />}
            view={view}
            onViewChange={(next) => setView(next === 'tiles' ? 'tiles' : 'list')}
          />
        )
      }
    >
      {() => <DraftList query={query} kind={kind} view={view} />}
    </CloudPage>
  );
}
