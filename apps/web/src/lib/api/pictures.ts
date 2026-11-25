import { API_PREFIX, type MePicture, type PeoplePictures } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountHeader, apiErrorFromText, apiRequest, unreachableError } from '../api-client';

/** One's own picture (Konto › Profil) and the pictures of the people one sees. */
export const pictureKeys = {
  own: ['account', 'picture'] as const,
  people: ['people', 'pictures'] as const,
};

/** The links run out after hours (`/files/…`): asked again well before. */
const PEOPLE_REFRESH_MS = 60 * 60_000;

/** The pictures of the people one sees, by user id – for every avatar (`PeoplePicturesSync`). */
export const usePeoplePictures = (enabled: boolean) =>
  useQuery({
    queryKey: pictureKeys.people,
    queryFn: () => apiRequest<PeoplePictures>('/people/pictures'),
    enabled,
    staleTime: PEOPLE_REFRESH_MS,
    refetchInterval: PEOPLE_REFRESH_MS,
  });

/** One's own picture, and whether „Profibild mit KI“ is there. */
export const useMePicture = () =>
  useQuery({
    queryKey: pictureKeys.own,
    queryFn: () => apiRequest<MePicture>('/me/picture'),
    staleTime: 60_000,
  });

const form = (picture: Blob, fields: Record<string, string> = {}) => {
  const body = new FormData();
  body.append('file', picture, 'bild.jpg');
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return body;
};

/** Keeps a picture (an upload, or one the AI made) as one's own – every avatar shows it then. */
export function useSetPicture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (picture: Blob) =>
      apiRequest<MePicture>('/me/picture', { method: 'PUT', body: form(picture) }),
    onSuccess: (picture) => {
      queryClient.setQueryData(pictureKeys.own, picture);
      void queryClient.invalidateQueries({ queryKey: pictureKeys.people });
    },
  });
}

/** Back to the picture seeded by the name. */
export function useDeletePicture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>('/me/picture', { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.setQueryData<MePicture>(pictureKeys.own, (before) =>
        before ? { ...before, url: null } : before,
      );
      void queryClient.invalidateQueries({ queryKey: pictureKeys.people });
    },
  });
}

/** A professional portrait the image model made from `photo` – shown first, not yet kept. */
export async function makeProfessionalPicture(
  photo: Blob,
  wish: string,
  signal?: AbortSignal,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}/me/picture/professional`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'image/jpeg, application/json', ...accountHeader() },
      body: form(photo, { wish }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw unreachableError();
  }
  if (!response.ok) throw apiErrorFromText(response.status, await response.text());
  return response.blob();
}
