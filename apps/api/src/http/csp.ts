import { API_PREFIX } from '@slider/shared';

/**
 * Content Security Policy of the web app's HTML. Report-only for now: browsers block nothing and
 * send what the policy would have blocked to {@link CSP_REPORT_PATH}, which logs it. Switch to
 * `true` once the server log stays quiet in real use.
 */
export const ENFORCE_CSP = false;

export const CSP_REPORT_PATH = `${API_PREFIX}/csp-report`;
/** The `report-to` group, named in `Reporting-Endpoints`. */
const REPORT_GROUP = 'csp';

/**
 * Microsoft's OneDrive File Picker v8 (`sources/onedrive-picker`): the web app posts a form with
 * the first token into an iframe – the consumer picker for personal accounts, the tenant's
 * SharePoint (`contoso-my.sharepoint.com/_layouts/15/FilePicker.aspx`) for work and school.
 */
const ONEDRIVE_PICKER = ['https://onedrive.live.com', 'https://*.sharepoint.com'];

/**
 * Everything else comes from the app's own origin: scripts and the frame-clock worker (Vite
 * bundles), the stylesheet and Inter (fontsource, bundled), the API, the live stream and signed
 * `/files` links. Google Drive, Stripe and the logins are top-level navigations, the Nextcloud
 * login a popup – none of them is loaded into the page. No inline scripts or `<style>` elements:
 * React sets `style` props through the CSSOM, which `style-src` does not restrict.
 */
const DIRECTIVES: [string, ...string[]][] = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
  ['font-src', "'self'"],
  // `data:`: generated avatars (DiceBear); `blob:`: images and recordings before upload.
  ['img-src', "'self'", 'data:', 'blob:'],
  ['media-src', "'self'", 'blob:'],
  ['connect-src', "'self'"],
  ['worker-src', "'self'"],
  ['frame-src', ...ONEDRIVE_PICKER],
  ['form-action', "'self'", ...ONEDRIVE_PICKER],
  ['frame-ancestors', "'self'"],
  ['object-src', "'none'"],
  ['base-uri', "'self'"],
  // `report-uri` for browsers without the Reporting API (Firefox, older Safari); Chrome uses `report-to`.
  ['report-uri', CSP_REPORT_PATH],
  ['report-to', REPORT_GROUP],
];

export const CONTENT_SECURITY_POLICY = DIRECTIVES.map((d) => d.join(' ')).join('; ');

/** Headers for an HTML document of the web app. */
export function cspHeaders(): Record<string, string> {
  const name = ENFORCE_CSP ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
  return {
    [name]: CONTENT_SECURITY_POLICY,
    'Reporting-Endpoints': `${REPORT_GROUP}="${CSP_REPORT_PATH}"`,
  };
}

/** Content types browsers send violation reports with. */
export const CSP_REPORT_TYPES = [
  'application/csp-report',
  'application/reports+json',
  'application/json',
];

/** At most this many violations of one request reach the log. */
const MAX_LOGGED = 5;

/**
 * One log line per violation in a report body – `report-uri` (`{"csp-report": {…}}`) or the
 * Reporting API (`[{type: "csp-violation", body: {…}}]`). Only the directive, the blocked origin,
 * the first segment of the page's path and the script position: no query strings, no samples.
 */
export function describeCspReports(body: unknown): string[] {
  const reports: unknown[] = Array.isArray(body) ? body : [body];
  const lines: string[] = [];
  for (const report of reports) {
    const violation = violationOf(report);
    if (violation) lines.push(violation);
    if (lines.length === MAX_LOGGED) break;
  }
  return lines;
}

function violationOf(report: unknown): string | null {
  if (!isRecord(report)) return null;
  // report-uri: `{"csp-report": {"effective-directive", "blocked-uri", "document-uri", …}}`
  const legacy = report['csp-report'];
  if (isRecord(legacy)) {
    return describe({
      directive: text(legacy['effective-directive']) ?? text(legacy['violated-directive']),
      blocked: text(legacy['blocked-uri']),
      document: text(legacy['document-uri']),
      source: text(legacy['source-file']),
      line: legacy['line-number'],
      disposition: text(legacy['disposition']),
    });
  }
  // Reporting API: `{"type": "csp-violation", "body": {"effectiveDirective", "blockedURL", …}}`
  const body = report['body'];
  if (report['type'] !== 'csp-violation' || !isRecord(body)) return null;
  return describe({
    directive: text(body['effectiveDirective']),
    blocked: text(body['blockedURL']),
    document: text(body['documentURL']) ?? text(report['url']),
    source: text(body['sourceFile']),
    line: body['lineNumber'],
    disposition: text(body['disposition']),
  });
}

interface Violation {
  directive: string | null;
  blocked: string | null;
  document: string | null;
  source: string | null;
  line: unknown;
  disposition: string | null;
}

function describe(v: Violation): string | null {
  const directive = v.directive?.split(' ')[0];
  if (!directive || !/^[a-z-]{1,40}$/.test(directive)) return null;
  const mode = v.disposition === 'enforce' ? 'blocked' : 'would block';
  const parts = [`${directive} ${mode} ${blockedOf(v.blocked)}`, `on ${pageOf(v.document)}`];
  const source = urlOf(v.source);
  if (source) {
    const line = typeof v.line === 'number' && Number.isInteger(v.line) ? `:${v.line}` : '';
    parts.push(`from ${source.origin}${source.pathname.slice(0, 120)}${line}`);
  }
  return parts.join(' ');
}

/** The blocked resource's origin, or the keyword (`inline`, `eval`, `data`, `blob`, …). */
function blockedOf(blocked: string | null): string {
  if (!blocked) return '(none)';
  const url = urlOf(blocked);
  if (url && url.origin !== 'null') return url.origin;
  const keyword = /^[a-z-]{1,20}/.exec(blocked)?.[0];
  return keyword ?? '(other)';
}

/** `/d/…` for `https://slider.example/d/abc?slide=2`: which page, not which deck or token. */
function pageOf(document: string | null): string {
  const url = urlOf(document);
  if (!url) return '(unknown page)';
  const [, first = '', ...rest] = url.pathname.split('/');
  const segment = /^[\w.-]{0,40}$/.test(first) ? first : '…';
  return rest.length > 0 ? `/${segment}/…` : `/${segment}`;
}

function urlOf(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return /^(https?|wss?):$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, 2048) : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
