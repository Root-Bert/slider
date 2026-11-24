import { CloudPage } from './components/CloudPage';
import { ScopeTabs } from './components/ScopeTabs';
import { AssignedFilter, TodoList, useTodoScope } from './components/todos/TodoList';

/**
 * Cloud's „Aufgaben“: the overview – tabs as the title, as Post's mailboxes: all, one's own, the
 * workspace's, then each area's.
 */
export function Component() {
  const { tabs, current } = useTodoScope();
  return (
    <CloudPage
      docTitle="Aufgaben"
      title={<ScopeTabs tabs={tabs} current={current} />}
      crumbs={[{ label: 'Aufgaben' }]}
      actions={<AssignedFilter />}
      nodes={[]}
    >
      {() => <TodoList area={null} />}
    </CloudPage>
  );
}
