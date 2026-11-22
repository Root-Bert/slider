import { CloudPage } from './components/CloudPage';
import { TodoList } from './components/todos/TodoList';
import { useCloud } from './hooks/useCloud';

/** Cloud's „Aufgaben“: the overview – one's own and every area's one sees, by where they stand. */
export function Component() {
  const ui = useCloud();
  return (
    <CloudPage
      docTitle="Aufgaben"
      title="Aufgaben"
      crumbs={[{ label: ui.workspace.name }, { label: 'Aufgaben' }]}
      subtitle="Deine – nur du siehst sie – und die aus allen Bereichen, die du siehst."
      nodes={[]}
    >
      {() => <TodoList area={null} />}
    </CloudPage>
  );
}
