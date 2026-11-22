import { useNavigate } from 'react-router';
import { searchFold, type WriterTemplate } from '@slider/shared';
import { useCreateDocument } from '@/lib/api/writer';
import { routes } from '@/lib/routes';
import { DOCUMENT_TEMPLATES } from '../lib/templates';
import { Button, cn, EmptyState, Icon, type ShowToast } from '@/ui';

/** Upright sheets stand closer than slides: more of them in a row (as the documents). */
const GRID =
  'grid grid-cols-2 gap-x-8 gap-y-10 @min-[636px]:grid-cols-3 @min-[900px]:grid-cols-4 @min-[1136px]:grid-cols-5';

const LINE = {
  title: 'h-[5%] w-3/5 bg-neutral-800',
  heading: 'mt-[3%] h-[3%] w-2/5 bg-neutral-700',
  text: 'h-[1.6%] w-full bg-neutral-300',
  short: 'h-[1.6%] w-1/2 bg-neutral-300',
  gap: 'h-[3%]',
} as const;

function Sheet({ lines }: { lines: (typeof DOCUMENT_TEMPLATES)[number]['lines'] }) {
  return (
    <div
      aria-hidden
      className="flex aspect-[210/297] w-full flex-col gap-[2.4%] bg-white px-[12%] py-[12%]"
    >
      {lines.map((line, index) => (
        <span key={index} className={cn('block shrink-0 rounded-full', LINE[line])} />
      ))}
    </div>
  );
}

/**
 * „Vorlagen“ in Writer's library: what a text document starts from. A click makes a document
 * of it and opens it – the same four „Neues Dokument“ offers.
 */
export function DocumentTemplates({
  workspaceId,
  query,
  view,
  canCreate,
  onNotify,
}: {
  workspaceId: string;
  query: string;
  view: 'grid' | 'list';
  canCreate: boolean;
  onNotify: ShowToast;
}) {
  const navigate = useNavigate();
  const create = useCreateDocument(workspaceId);
  const needle = searchFold(query.replace(/\s+/g, ' ').trim());
  const shown = DOCUMENT_TEMPLATES.filter(
    (each) => searchFold(each.label).includes(needle) || searchFold(each.about).includes(needle),
  );
  const start = (template: WriterTemplate) => {
    if (!canCreate || create.isPending) return;
    create.mutate(
      { template },
      {
        onSuccess: (document) => void navigate(routes.document(document.id)),
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );
  };
  if (shown.length === 0) {
    return (
      <EmptyState
        title={`Keine Treffer für „${query.trim()}“`}
        message="Versuche einen anderen Suchbegriff."
      />
    );
  }
  if (view === 'list') {
    return (
      <ul className="glass flex flex-col gap-1 rounded-panel p-1.5">
        {shown.map(({ template, label, icon, about }) => (
          <li
            key={template}
            className="flex min-w-0 items-center gap-3 rounded-control px-3 py-2 hover:bg-glass-hover"
          >
            <Icon name={icon} size={20} className="shrink-0 text-fg-muted" />
            <span className="min-w-0 truncate text-body font-medium text-fg">{label}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-fg-subtle">{about}</span>
            {canCreate && (
              <Button
                variant="secondary"
                size="sm"
                icon="add"
                disabled={create.isPending}
                onClick={() => start(template)}
              >
                Neues Dokument
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={GRID}>
      {shown.map(({ template, label, about, lines }) => (
        <li key={template} className="min-w-0">
          <article className="group flex min-w-0 flex-col gap-3">
            <button
              type="button"
              disabled={!canCreate || create.isPending}
              aria-label={`Neues Dokument aus „${label}“`}
              title={canCreate ? 'Neues Dokument' : undefined}
              onClick={() => start(template)}
              className="block w-full overflow-hidden rounded-panel shadow-mark ring-2 ring-transparent transition-[box-shadow,scale] duration-300 group-hover:scale-[0.97] group-hover:ring-fg focus-visible:ring-fg focus-visible:outline-none disabled:cursor-default"
            >
              <Sheet lines={lines} />
            </button>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h3 className="truncate text-lg font-medium text-fg">{label}</h3>
              <p className="truncate text-sm text-fg-subtle">{about}</p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
