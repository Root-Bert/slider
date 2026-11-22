import { Fragment, useState } from 'react';
import type { SliderTemplate } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { Button, cn, collectionGridClass, Dialog, Icon } from '@/ui';
import type { MaterialView } from '../../lib/font-families';

interface SliderTemplateCollectionProps {
  /** Those the search left, in the catalogue's order (by group). */
  templates: readonly SliderTemplate[];
  view: MaterialView;
  /** Members and admins: a presentation made from one; `null` for who may not. */
  onCreate: ((template: SliderTemplate) => void) | null;
  creating: boolean;
}

const picture = (template: SliderTemplate, index: number) => template.layouts[index]?.thumbnailUrl;

/**
 * The templates Slider brings along, under the workspace's own: by group, each a stack like a
 * design of the workspace (`MasterCard`). A click shows its layouts; from there, or the card's
 * button, a presentation is made of it. Nothing to rename, delete or select – they are Slider's.
 */
export function SliderTemplateCollection({
  templates,
  view,
  onCreate,
  creating,
}: SliderTemplateCollectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = templates.find((template) => template.id === openId);
  if (templates.length === 0) return null;
  const groups = [...new Set(templates.map((template) => template.group))];
  return (
    <section aria-label="Vorlagen von Slider" className="flex flex-col gap-6">
      {groups.map((group) => (
        <Fragment key={group}>
          <h2 className="text-sm font-medium text-fg-muted">{group}</h2>
          {view === 'list' ? (
            <ul className="glass flex flex-col gap-1 rounded-panel p-1.5">
              {templates
                .filter((template) => template.group === group)
                .map((template) => (
                  <li key={template.id} className="min-w-0">
                    <article className="group relative flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors hover:bg-surface-1">
                      <img
                        src={picture(template, 0)}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="aspect-video w-24 shrink-0 rounded-badge bg-white object-contain"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <h3 className="truncate text-sm font-medium text-fg">
                          {/* The whole row opens it; the button sits above. */}
                          <button
                            type="button"
                            onClick={() => setOpenId(template.id)}
                            className="text-left after:absolute after:inset-0 focus-visible:outline-none"
                          >
                            {template.name}
                          </button>
                        </h3>
                        <p className="truncate text-body text-fg-subtle">{template.description}</p>
                      </div>
                      <span className="shrink-0 text-body text-fg-subtle max-md:hidden">
                        {pluralize(template.layouts.length, 'Layout', 'Layouts')}
                      </span>
                      {onCreate && (
                        <Button
                          size="xs"
                          icon="add"
                          disabled={creating}
                          onClick={() => onCreate(template)}
                          className="relative shrink-0 max-sm:hidden"
                        >
                          Präsentation erstellen
                        </Button>
                      )}
                    </article>
                  </li>
                ))}
            </ul>
          ) : (
            <ul className={cn(collectionGridClass, 'pt-6 pb-8')}>
              {templates
                .filter((template) => template.group === group)
                .map((template) => (
                  <li key={template.id} className="min-w-0">
                    <article className="group relative flex min-w-0 flex-col gap-3">
                      <div className="relative isolate">
                        {[2, 1].map((index) =>
                          picture(template, index) ? (
                            <img
                              key={index}
                              src={picture(template, index)}
                              alt=""
                              loading="lazy"
                              draggable={false}
                              className={cn(
                                'absolute inset-0 aspect-video w-full rounded-panel bg-white object-contain opacity-70 shadow-mark transition-transform duration-300',
                                index === 1
                                  ? 'translate-x-2.5 -translate-y-2.5 rotate-[1.5deg] group-hover:translate-x-4 group-hover:-translate-y-3.5'
                                  : 'translate-x-5 -translate-y-5 rotate-3 group-hover:translate-x-7 group-hover:-translate-y-6',
                              )}
                            />
                          ) : null,
                        )}
                        <button
                          type="button"
                          onClick={() => setOpenId(template.id)}
                          aria-label={`„${template.name}“ öffnen`}
                          className="relative block aspect-video w-full overflow-hidden rounded-panel ring-2 ring-transparent transition-[box-shadow,scale] duration-300 group-hover:scale-[0.97] group-hover:ring-fg focus-visible:ring-fg focus-visible:outline-none"
                        >
                          <img
                            src={picture(template, 0)}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="size-full bg-white object-contain"
                          />
                        </button>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-lg font-medium text-fg">
                          {template.name}
                        </h3>
                        <span
                          title={pluralize(template.layouts.length, 'Layout', 'Layouts')}
                          className="ml-auto inline-flex shrink-0 items-center gap-1 text-sm text-fg-subtle"
                        >
                          <Icon name="slideStack" size={16} />
                          {template.layouts.length}
                        </span>
                        {onCreate && (
                          <Button
                            size="sm"
                            icon="add"
                            disabled={creating}
                            onClick={() => onCreate(template)}
                            className="shrink-0"
                          >
                            Präsentation erstellen
                          </Button>
                        )}
                      </div>
                    </article>
                  </li>
                ))}
            </ul>
          )}
        </Fragment>
      ))}
      {open && (
        <Dialog
          open
          onClose={() => setOpenId(null)}
          title={open.name}
          description={open.description}
          className="w-[min(960px,calc(100vw-32px))]!"
          footer={
            onCreate && (
              <Button icon="add" disabled={creating} onClick={() => onCreate(open)}>
                Präsentation erstellen
              </Button>
            )
          }
        >
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {open.layouts.map((layout, index) => (
              <li key={index} className="flex min-w-0 flex-col gap-1.5">
                <img
                  src={layout.thumbnailUrl}
                  alt=""
                  draggable={false}
                  className="aspect-video w-full rounded-control-sm bg-white object-contain"
                />
                <span className="truncate text-body text-fg-muted">{layout.name}</span>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </section>
  );
}
