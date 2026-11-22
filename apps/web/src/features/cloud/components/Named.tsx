import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cloudFileType } from '@slider/shared';
import { Icon, type IconName } from '@/ui';
import { NAMED, namedHref, type Named, type NamedKind } from '../lib/named';
import { FileIcon } from './FileIcon';

const NAMED_ICONS: Record<Exclude<NamedKind, 'file'>, IconName> = {
  folder: 'folder',
  area: 'workspaces',
  presentation: 'slideshow',
};

export function NamedIcon({ named, size = 20 }: { named: Named; size?: 20 | 32 }) {
  return named.kind === 'file' ? (
    <FileIcon kind="file" type={cloudFileType(named.name)} size={size} />
  ) : (
    <Icon name={NAMED_ICONS[named.kind]} size={size} className="shrink-0 text-fg-muted" />
  );
}

const LINK =
  'rounded-chip font-medium text-fg underline decoration-fg-subtle underline-offset-2 hover:decoration-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none';

/**
 * A run of an answer's text, what it names as links: `onOpen` decides where (Cloud: a file's
 * details beside); without it each is a link to where it opens (`namedHref` – Sender).
 */
export function WithNamed({
  text,
  workspaceId,
  onOpen,
}: {
  text: string;
  workspaceId: string;
  onOpen?: ((named: Named) => void) | undefined;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(NAMED)) {
    parts.push(text.slice(at, match.index));
    at = match.index + match[0].length;
    const named: Named = { kind: match[1] as NamedKind, id: match[2]!, name: match[3]!.trim() };
    parts.push(
      onOpen ? (
        <button key={match.index} type="button" onClick={() => onOpen(named)} className={LINK}>
          {named.name}
        </button>
      ) : (
        <Link key={match.index} to={namedHref(workspaceId, named)} className={LINK}>
          {named.name}
        </Link>
      ),
    );
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
