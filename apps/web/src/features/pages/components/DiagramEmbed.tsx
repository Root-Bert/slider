import type { NodeKey } from 'lexical';
import { Link, useNavigate } from 'react-router';
import { DiagramPreview } from '@/features/diagrams';
import { useDiagram } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { cn, Icon } from '@/ui';
import { usePageHost } from './PageHost';
import { useBlockPick } from './useBlockPick';

const titleOf = (name: string) => name.replace(/\.diagram$/i, '');

/**
 * A diagram from Cloud on the page, drawn as it is now. In Lesen a click opens it; in Bearbeiten a
 * click picks it (⌫ takes it off the page, the file stays), a double click or „Öffnen“ opens it in
 * its editor. What cannot be shown (gone, not one's to see) says so where it stands.
 */
export function DiagramEmbed({ id, name, nodeKey }: { id: string; name: string; nodeKey: NodeKey }) {
  const host = usePageHost();
  const navigate = useNavigate();
  const { editable, picked, pick } = useBlockPick(nodeKey);
  const opened = useDiagram(id);
  const href = host.linkTo('file', id, name);
  const status = opened.error instanceof ApiError ? opened.error.status : opened.error ? 0 : null;
  const title = opened.data?.file.title ?? titleOf(name);
  const empty = opened.data && opened.data.diagram.nodes.length === 0;

  const body =
    status !== null ? (
      <p className="page-diagram-embed-note">
        <Icon name="warning" size={16} />
        {status === 404
          ? 'Dieses Diagramm gibt es nicht mehr.'
          : status === 403
            ? 'Dieses Diagramm ist nicht für dich freigegeben.'
            : 'Das Diagramm ließ sich nicht laden.'}
      </p>
    ) : !opened.data ? (
      <div className="page-diagram-embed-wait" />
    ) : empty ? (
      <p className="page-diagram-embed-note">Noch leer – öffne es zum Zeichnen.</p>
    ) : (
      <DiagramPreview diagram={opened.data.diagram} maxHeight={520} />
    );

  const caption = (
    <span className="page-diagram-embed-caption">
      <Icon name="accountTree" size={16} />
      <span className="truncate">{title}</span>
    </span>
  );

  if (!editable) {
    return (
      <Link to={href} className="page-diagram-embed" aria-label={`${title} öffnen`}>
        {body}
        {caption}
      </Link>
    );
  }
  return (
    <div
      className={cn('page-diagram-embed', picked && 'page-picked')}
      onClick={pick}
      onDoubleClick={() => void navigate(href)}
    >
      {body}
      <span className="page-diagram-embed-foot">
        {caption}
        <Link
          to={href}
          className="page-diagram-embed-open"
          onClick={(event) => event.stopPropagation()}
        >
          Öffnen
        </Link>
      </span>
    </div>
  );
}
