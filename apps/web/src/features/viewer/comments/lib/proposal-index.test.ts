import type { AiProposal } from '@slider/shared';
import { expect, it } from 'vitest';
import { proposalsByComment } from './proposal-index';

it('shares unchanged results across cards and keeps oldest-first order when the data changes', () => {
  const proposal = (id: string, commentId: string | null) => ({ id, commentId }) as AiProposal;
  const data = [proposal('new', 'a'), proposal('unattached', null), proposal('old', 'a')];
  const lookup = proposalsByComment(data);
  for (let card = 0; card < 13; card++) expect(proposalsByComment(data)).toBe(lookup);
  expect(lookup('a').map((entry) => entry.id)).toEqual(['old', 'new']);
  expect(data.map((entry) => entry.id)).toEqual(['new', 'unattached', 'old']);
  expect(lookup('missing')).toBe(proposalsByComment(undefined)('missing'));
  expect(proposalsByComment([])('a')).toHaveLength(0);
  const changed = proposalsByComment([proposal('newest', 'a'), ...data]);
  expect(changed).not.toBe(lookup);
  expect(changed('a').map((entry) => entry.id)).toEqual(['old', 'new', 'newest']);
  expect(lookup('a').map((entry) => entry.id)).toEqual(['old', 'new']);
});
