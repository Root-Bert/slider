import type { Author } from '@slider/shared';
import { createContext, useContext } from 'react';
import { ViewerDataContext } from '../state/viewer-data';

/** Who can be @mentioned in a comment field, the names known in the text, and who writes. */
export interface MentionPeople {
  mentionable: Author[];
  participantNames: string[];
  myName: string;
}

/**
 * The people of what is commented on, where it is no deck – a text document gives its own; on a
 * slide they come from the viewer's data.
 */
export const MentionPeopleContext = createContext<MentionPeople | null>(null);

export function useMentionPeople(): MentionPeople {
  const own = useContext(MentionPeopleContext);
  const viewer = useContext(ViewerDataContext);
  if (own) return own;
  if (!viewer) throw new Error('useMentionPeople needs <MentionPeopleContext> or the viewer');
  return {
    mentionable: viewer.mentionable,
    participantNames: viewer.participantNames,
    myName: viewer.viewer.author.name,
  };
}
