import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import { rememberLinkLogin, takeLinkLogin } from './link-login';

const LINK = 'https://contoso.sharepoint.com/sites/x/Shared%20Documents/deck.pptx';

afterEach(() => vi.unstubAllGlobals());

describe('link login marker', () => {
  it('accepts the link and workspace this tab started the login for, once', () => {
    const { values } = stubStorage({}, 'sessionStorage');
    rememberLinkLogin(LINK, 'ws1');
    expect(values.size).toBe(1);
    expect(takeLinkLogin(LINK, 'ws1')).toBe(true);
    expect(values.size).toBe(0);
    expect(takeLinkLogin(LINK, 'ws1')).toBe(false);
  });

  it('refuses a crafted URL: no login started in this tab', () => {
    stubStorage({}, 'sessionStorage');
    expect(takeLinkLogin(LINK, 'ws1')).toBe(false);
  });

  it('refuses another link or another workspace, and clears the marker', () => {
    const { values } = stubStorage({}, 'sessionStorage');
    rememberLinkLogin(LINK, 'ws1');
    expect(takeLinkLogin('https://evil.example/x.pptx', 'ws1')).toBe(false);
    expect(values.size).toBe(0);
    rememberLinkLogin(LINK, 'ws1');
    expect(takeLinkLogin(LINK, 'ws2')).toBe(false);
  });

  it('refuses when storage is unavailable', () => {
    stubBrokenStorage('sessionStorage');
    rememberLinkLogin(LINK, 'ws1');
    expect(takeLinkLogin(LINK, 'ws1')).toBe(false);
  });
});
