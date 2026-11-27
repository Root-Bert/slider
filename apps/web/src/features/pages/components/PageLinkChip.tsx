import { Link } from 'react-router';
import { Icon, type IconName } from '@/ui';
import type { PageLinkKind } from '../lib/nodes';
import { usePageHost } from './PageHost';

const ICONS: Record<PageLinkKind, IconName> = {
  file: 'description',
  folder: 'folder',
  area: 'groups',
  presentation: 'slideshow',
};

const PAGE = /\.(md|markdown)$/i;

/**
 * A file, folder, area or presentation named in a page: its icon and name, a link to it. On a
 * line of its own it is a page under this one and drawn as a row (`page.css`). The link keeps the
 * file's whole name (where it opens goes by it); a page shows its title, without the ending.
 */
export function PageLinkChip({
  kind,
  target,
  name,
}: {
  kind: PageLinkKind;
  target: string;
  name: string;
}) {
  const { linkTo, nameOf } = usePageHost();
  const page = kind === 'file' && PAGE.test(name);
  const shown = (kind === 'file' && nameOf?.(target)) || name;
  return (
    <Link
      to={linkTo(kind, target, name)}
      className="page-link-chip"
      data-kind={kind}
      // The editor's selection is not moved into it: a click opens it.
      contentEditable={false}
      draggable={false}
    >
      <Icon name={page ? 'article' : ICONS[kind]} size={16} />
      <span>{page ? shown.replace(PAGE, '') : shown}</span>
    </Link>
  );
}
