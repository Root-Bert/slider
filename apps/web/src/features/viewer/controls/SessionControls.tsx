import { IconButton } from '@/ui';
import { useCloseDeck } from '../hooks/useCloseDeck';

/**
 * Last button of the deck pill: closes the review – back to the ideas, or for a template being
 * designed back to the library's templates. Inviting people lives in the workspace's members.
 */
export function SessionControls() {
  const { label, close } = useCloseDeck();
  return <IconButton icon="close" label={label} size="sm" onClick={close} />;
}
