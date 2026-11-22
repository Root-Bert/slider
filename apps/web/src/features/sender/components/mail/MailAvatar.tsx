import { useState } from 'react';
import { API_PREFIX, emailDomain, FREEMAIL_DOMAINS, type MailPerson } from '@slider/shared';
import { generatedGlyph } from '@/lib/generated-avatar';
import { Avatar, type AvatarSize } from '@/ui';
import { useSender } from '../../hooks/useSender';
import { mailAuthor } from '../../lib/mail';

/** What each firm's picture came to in this tab: shown at once next time, or never asked again. */
const logos = new Map<string, 'shown' | 'none'>();

/**
 * A person of a mail: a colleague as everywhere in the workspace; anyone else a glyph of their
 * address, with their firm's logo over it (BIMI or the site's icon, looked up by Slider's server
 * by the domain alone – `services/mail-logos.ts`) where their domain vouched for the mail
 * (`vouched`) and is no mail provider's. The glyph stands at once; the logo only once it has
 * loaded – no wait, no shift.
 */
export function MailAvatar({
  person,
  vouched,
  size,
  nativeTitle,
}: {
  person: Pick<MailPerson, 'name' | 'address' | 'userId'>;
  vouched: boolean;
  size: AvatarSize;
  nativeTitle?: boolean;
}) {
  const ui = useSender();
  const author = mailAuthor(person, ui.home?.people ?? []);
  if (person.userId && author.id === person.userId) {
    return <Avatar author={author} size={size} nativeTitle={nativeTitle} />;
  }
  const domain = emailDomain(person.address);
  const firm = vouched && domain.includes('.') && !FREEMAIL_DOMAINS.has(domain) ? domain : null;
  return (
    <Avatar
      author={author}
      size={size}
      nativeTitle={nativeTitle}
      picture={generatedGlyph(person.address)}
    >
      {firm && logos.get(firm) !== 'none' && (
        <FirmLogo
          key={firm}
          src={`${API_PREFIX}/workspaces/${ui.workspace.id}/mail/logos/${encodeURIComponent(firm)}`}
          firm={firm}
          inset={size >= 32 ? 2 : 1.5}
        />
      )}
    </Avatar>
  );
}

function FirmLogo({ src, firm, inset }: { src: string; firm: string; inset: number }) {
  const [state, setState] = useState(logos.get(firm) ?? 'loading');
  if (state === 'none') return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => {
        logos.set(firm, 'shown');
        setState('shown');
      }}
      onError={() => {
        logos.set(firm, 'none');
        setState('none');
      }}
      className="absolute rounded-full object-cover transition-opacity duration-200"
      style={{ inset, opacity: state === 'shown' ? 1 : 0 }}
    />
  );
}
