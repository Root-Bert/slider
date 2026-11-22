import { useNavigate } from 'react-router';
import { Button } from '@/ui';
import { appStart, useCurrentApp } from '@/lib/apps';
import { CenteredMessage } from '@/shell/CenteredMessage';

export function Component() {
  const navigate = useNavigate();
  const home = appStart(useCurrentApp());
  return (
    <CenteredMessage title="Seite nicht gefunden" message="Diese Adresse gibt es nicht (mehr).">
      <Button onClick={() => navigate(home.to)}>{home.label}</Button>
    </CenteredMessage>
  );
}
