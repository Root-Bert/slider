import { createBrowserRouter } from 'react-router';
import { RouteError } from './RouteError';

/**
 * Feature pages are lazy-loaded so the guest entry and the viewer don't ship the whole app.
 * Each page module exports `Component` (React Router lazy-route convention).
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: () => import('@/features/reviews/ReviewsPage') },
      { path: 'neu', lazy: () => import('@/features/onboarding/NewReviewPage') },
      { path: 'd/:deckId', lazy: () => import('@/features/viewer/DeckPage') },
      { path: 'r/:token', lazy: () => import('@/features/sharing/GuestEntryPage') },
      { path: '*', lazy: () => import('./NotFoundPage') },
    ],
  },
]);
