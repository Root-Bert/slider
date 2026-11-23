import { emailDomain, orgDomain } from '@slider/shared';
import { isCompanyMailDomain } from './workspaces/domains';

/**
 * The firm's domain of an address, where a domain rule may stand (`mail-rules`) – `null` at a mail
 * provider (gmail.com, web.de …), where anyone has an address.
 */
export function ruleDomain(address: string): string | null {
  const domain = emailDomain(address.toLowerCase());
  const org = orgDomain(domain);
  return isCompanyMailDomain(domain) && isCompanyMailDomain(org) ? org : null;
}
