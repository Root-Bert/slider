import { AuthPage } from './LoginPage';

/** `/registrieren` – the login page under its sign-up name; the first login creates the account. */
export function Component() {
  return <AuthPage mode="register" />;
}
