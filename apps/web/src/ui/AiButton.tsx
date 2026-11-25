import { aiInSentence, aiNameOf } from '@slider/shared';
import { AI_ICON } from './ai-icon';
import { IconButton, type IconButtonProps } from './IconButton';

export interface AiButtonProps extends Omit<IconButtonProps, 'icon' | 'label'> {
  /** The workspace's name for its AI (`aiName`); unset: „KI“. */
  name?: string | undefined;
  /** A call goes on in its side panel while it is closed: the button shows that instead of ✨. */
  calling?: boolean;
}

/** The button that reaches the AI – the same look and words wherever it stands. */
export function AiButton({ name, calling = false, title, ...props }: AiButtonProps) {
  return (
    <IconButton
      icon={calling ? 'call' : AI_ICON}
      iconTone={calling ? 'success' : undefined}
      label={aiNameOf(name)}
      // In a call, its tooltip says so – over a place's own words, not over none (`false`).
      title={
        calling && title !== false
          ? 'Im Anruf – zeigt ihn in der Seitenleiste'
          : (title ?? `${aiInSentence(name, true)} fragen`)
      }
      {...props}
    />
  );
}
