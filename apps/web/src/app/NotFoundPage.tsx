import { useNavigate } from 'react-router';
import { Button } from '@/ui';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';

export function Component() {
  const navigate = useNavigate();
  return (
    <CenteredMessage title="Seite nicht gefunden" message="Diese Adresse gibt es nicht (mehr).">
      <Button onClick={() => navigate(routes.reviews())}>Zu meinen Reviews</Button>
    </CenteredMessage>
  );
}
