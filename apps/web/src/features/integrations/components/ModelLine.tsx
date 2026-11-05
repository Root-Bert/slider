import type { ReactNode } from 'react';
import { AI_MODEL_ROLES, type AiModelRole } from '../lib/ai-models';

/**
 * One model line of a key's row: its label, the pick (or name), something at its end – and for
 * the AI's two models a short line on what each is for.
 */
export function ModelLine({
  role,
  children,
  end,
}: {
  /** `null`: a kind with one model. */
  role: AiModelRole | null;
  children: ReactNode;
  end?: ReactNode;
}) {
  const about = role ? AI_MODEL_ROLES[role] : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        {about ? about.label : 'Modell'}:{children}
        {end && <span className="ml-auto">{end}</span>}
      </div>
      {about && <p className="text-xs text-fg-subtle">{about.hint}</p>}
    </div>
  );
}
