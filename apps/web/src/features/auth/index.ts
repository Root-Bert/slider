/** Public API of the auth feature. Route pages stay out, so they keep their own lazy chunks. */
export { LoginErrorBanner } from './components/LoginBits';
export { LoginOptions } from './components/LoginOptions';
export { NextcloudSignIn } from './components/NextcloudSignIn';
export { useAccount } from './hooks/useAccount';
export { isSignedOutError } from './lib/gate';
export { isLoginError, providerLoginUrl } from './lib/return-to';
