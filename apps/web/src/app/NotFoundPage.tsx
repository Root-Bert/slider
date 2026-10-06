import { useNavigate } from 'react-router';
import { Button } from '@/ui';
import { CenteredMessage } from './RouteError';
import { routes } from './routes';

export function Component() {
  const navigate = useNavigate();
  return (
    <CenteredMessage title="Seite nicht gefunden" message="Diese Adresse gibt es nicht (mehr).">
      <Button onClick={() => navigate(routes.reviews())}>Zu meinen Reviews</Button>
    </CenteredMessage>
  );
}
