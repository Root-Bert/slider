import { useEffect } from 'react';
import { CLOUD_VERSION_DAYS } from '@slider/shared';
import { useCloudNode } from '@/lib/api';
import { VersionList } from '@/features/cloud';
import { useWriter } from './session';

/**
 * The document's versions („Fassungen“), as Cloud lists a file's: every person's typing within ten
 * minutes is one, named ones stay for good. Brought back, the open document reads itself anew
 * (`restored` on its stream) – here and wherever it is open.
 */
export function DocumentVersions({ onRestored }: { onRestored: () => void }) {
  const { engine, document, notify } = useWriter();
  const detail = useCloudNode(document.workspaceId, document.id);
  // The text's format bar would lie over the list: the text is let go of, as Esc does.
  useEffect(() => engine.blur(), [engine]);
  // Every saved step may be a new version: read anew whenever it opens.
  const { refetch } = detail;
  useEffect(() => void refetch(), [refetch]);
  return (
    <div className="flex max-h-[min(560px,calc(100vh-8rem))] w-80 flex-col overflow-y-auto p-1">
      {detail.data ? (
        <VersionList
          node={detail.data.node}
          versions={detail.data.versions}
          notify={notify}
          onRestored={onRestored}
          note={`Was eine Person innerhalb von zehn Minuten schreibt, ist eine Fassung. Benannte Fassungen bleiben für immer, alle anderen ${CLOUD_VERSION_DAYS} Tage.`}
        />
      ) : (
        <p className="p-3 text-caption text-fg-subtle">
          {detail.error ? detail.error.message : 'Fassungen werden geladen …'}
        </p>
      )}
    </div>
  );
}
