import { useNavigate } from 'react-router';
import { Button } from '@/ui';
import { appBetween, appStart } from '@/lib/apps';
import { CenteredMessage } from '@/shell/CenteredMessage';

export function Component() {
  const navigate = useNavigate();
  // No page of any app: the one last open (an unknown address would otherwise count as Slider's).
  const app = appBetween();
  const home = appStart(app);
  return (
    <CenteredMessage
      app={app}
      title="Seite nicht gefunden"
      message="Diese Adresse gibt es nicht (mehr)."
    >
      <Button onClick={() => navigate(home.to)}>{home.label}</Button>
    </CenteredMessage>
  );
}
