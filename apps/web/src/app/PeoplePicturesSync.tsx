import { useEffect } from 'react';
import { useMe, usePeoplePictures } from '@/lib/api';
import { setPeoplePictures } from '@/lib/people-pictures';

/**
 * While someone is signed in, the pictures of the people they see go to every avatar
 * (`lib/people-pictures.ts`); signed out, none.
 */
export function PeoplePicturesSync() {
  const signedIn = !!useMe().data?.user;
  const { data } = usePeoplePictures(signedIn);
  useEffect(() => setPeoplePictures(signedIn && data ? data : {}), [signedIn, data]);
  return null;
}
