import { useParams } from 'react-router';
import { AreaHome } from './components/PlaceHome';

/* `/bereich/:id` – the area's Startseite (`PlaceHome`), its views as the title. */

export function Component() {
  const { areaId = '' } = useParams();
  // One area's page, made or not: another area is another page (the route keeps its instance).
  return <AreaHome key={areaId} areaId={areaId} />;
}
