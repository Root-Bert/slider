import { Toast } from '@/ui';
import { useSenderOrNull } from '../hooks/useSender';

/** What Sender says (sent, deleted, refused) – where its conversations stand. */
export function SenderToast() {
  const ui = useSenderOrNull();
  return ui ? <Toast toast={ui.toast} /> : null;
}
