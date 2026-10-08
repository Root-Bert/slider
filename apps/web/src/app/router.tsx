import { createBrowserRouter } from 'react-router';
import { RouteError } from './RouteError';

/**
 * Feature pages are lazy-loaded so the guest entry and the viewer don't ship the whole app.
 * Each page module exports `Component` (React Router lazy-route convention).
 *
 * Member pages sit below `AccountGate` (signed-out visitors go to `/login?returnTo=…`); the
 * guest entry `/r/:token`, the deck viewer (guests and members), login and the invitation
 * page stay outside it.
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    // Shown while the first lazy route module loads.
    hydrateFallbackElement: <div className="dot-grid min-h-full" aria-busy />,
    children: [
      { path: 'login', lazy: () => import('@/features/auth/LoginPage') },
      { path: 'registrieren', lazy: () => import('@/features/auth/RegisterPage') },
      { path: 'join/:token', lazy: () => import('@/features/workspaces/JoinPage') },
      { path: 'd/:deckId', lazy: () => import('@/features/viewer/DeckPage') },
      { path: 'r/:token', lazy: () => import('@/features/sharing/GuestEntryPage') },
      {
        lazy: () => import('@/features/auth/AccountGate'),
        children: [
          { index: true, lazy: () => import('@/features/workspaces/HomePage') },
          { path: 'neu', lazy: () => import('@/features/onboarding/NewReviewPage') },
          {
            path: 'w/:workspaceId',
            lazy: () => import('@/features/workspaces/WorkspaceLayout'),
            children: [
              { index: true, lazy: () => import('@/features/reviews/ReviewsPage') },
              {
                path: 'einstellungen',
                lazy: () => import('@/features/workspaces/SettingsPage'),
              },
            ],
          },
        ],
      },
      { path: '*', lazy: () => import('./NotFoundPage') },
    ],
  },
]);
