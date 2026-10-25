import { createBrowserRouter } from 'react-router';
import { RouteError } from './RouteError';

/**
 * Feature pages are lazy-loaded so the viewer doesn't ship the whole app.
 * Each page module exports `Component` (React Router lazy-route convention).
 *
 * Member pages sit below `AccountGate` (signed-out visitors go to `/login?returnTo=…`); the
 * deck viewer (sends signed-out visitors to the login itself), login and the invitation page
 * stay outside it. There are no guests: sharing invites into the workspace.
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    // Shown while the first lazy route module loads.
    hydrateFallbackElement: <div className="dot-grid min-h-full" aria-busy />,
    children: [
      { path: 'login', lazy: () => import('@/features/auth/LoginPage') },
      { path: 'registrieren', lazy: () => import('@/features/auth/RegisterPage') },
      { path: 'konto-bestaetigen/:token', lazy: () => import('@/features/auth/ConfirmSignUpPage') },
      { path: 'anmelden/:token', lazy: () => import('@/features/auth/EmailLoginPage') },
      // Self-hosting: setup token from the server log, or the instance admin (checked by the API).
      { path: 'einrichtung', lazy: () => import('@/features/setup/SetupPage') },
      { path: 'join/:token', lazy: () => import('@/features/workspaces/JoinPage') },
      { path: 'datenschutz', lazy: () => import('@/features/legal/PrivacyPage') },
      { path: 'impressum', lazy: () => import('@/features/legal/ImprintPage') },
      { path: 'datenanfrage', lazy: () => import('@/features/account/DataRequestFormPage') },
      { path: 'daten/:token', lazy: () => import('@/features/account/DataRequestPage') },
      { path: 'd/:deckId', lazy: () => import('@/features/viewer/DeckPage') },
      {
        lazy: () => import('@/features/auth/AccountGate'),
        children: [
          { index: true, lazy: () => import('@/features/workspaces/HomePage') },
          { path: 'neu', lazy: () => import('@/features/onboarding/NewReviewPage') },
          { path: 'konto', lazy: () => import('@/features/account/AccountPage') },
          { path: 'einstellungen', lazy: () => import('@/features/account/PreferencesPage') },
          { path: 'nutzung', lazy: () => import('@/features/account/UsagePage') },
          { path: 'instanz', lazy: () => import('@/features/instance/InstancePage') },
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
