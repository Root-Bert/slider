import { expect, it } from 'vitest';
import { pickedTransition, showPickedTransition } from './picked-transitions';

const deferred = () => {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((done) => (resolve = done));
  return { promise, resolve };
};

it('shows a picked transition at once – no waiting on the server – and settles back', async () => {
  expect(pickedTransition('s1')).toBeUndefined();

  const first = deferred();
  showPickedTransition('s1', 'fade', first.promise);
  expect(pickedTransition('s1')).toBe('fade');

  // A newer pick for the slide outlasts the older edit's answer.
  const second = deferred();
  showPickedTransition('s1', 'push', second.promise);
  first.resolve(true);
  await first.promise;
  expect(pickedTransition('s1')).toBe('push');

  // Answered (or refused): the edit state's value again.
  second.resolve(false);
  await second.promise;
  expect(pickedTransition('s1')).toBeUndefined();
});
