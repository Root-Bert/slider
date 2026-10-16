/** Public API of the auth feature. Route pages stay out, so they keep their own lazy chunks. */
export { LoginErrorBanner, SignupHint } from './components/LoginBits';
export { LoginOptions } from './components/LoginOptions';
export { useAccount } from './hooks/useAccount';
export { isSignedOutError } from './lib/gate';
export {
  ACCOUNT_LIMIT_MESSAGE,
  isLoginError,
  loginPath,
  providerLoginUrl,
  safeReturnTo,
} from './lib/return-to';
