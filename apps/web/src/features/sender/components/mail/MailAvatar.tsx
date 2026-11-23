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
 * loaded – no wait, no shift – and then alone, filling the circle: one round picture, as Gmail's
 * and Outlook's, no glyph's ring around it.
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
  const domain = emailDomain(person.address);
  const firm = vouched && domain.includes('.') && !FREEMAIL_DOMAINS.has(domain) ? domain : null;
  // Kept per firm (`key`): another sender in the same row starts from that firm's own state.
  const [logo, setLogo] = useState(() => (firm ? (logos.get(firm) ?? 'loading') : 'none'));
  const [logoOf, setLogoOf] = useState(firm);
  if (logoOf !== firm) {
    setLogoOf(firm);
    setLogo(firm ? (logos.get(firm) ?? 'loading') : 'none');
  }
  if (person.userId && author.id === person.userId) {
    return <Avatar author={author} size={size} nativeTitle={nativeTitle} />;
  }
  const src = firm
    ? `${API_PREFIX}/workspaces/${ui.workspace.id}/mail/logos/${encodeURIComponent(firm)}`
    : null;
  if (src && logo === 'shown')
    return (
      <span
        className="relative inline-flex shrink-0"
        style={{ width: size, height: size }}
        title={nativeTitle === false ? undefined : author.name}
      >
        <img
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          className="size-full rounded-full bg-white object-cover"
        />
      </span>
    );
  return (
    <Avatar
      author={author}
      size={size}
      nativeTitle={nativeTitle}
      picture={generatedGlyph(person.address)}
    >
      {src && logo === 'loading' && (
        // Loaded unseen over the glyph; then the logo stands alone (above).
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => {
            logos.set(firm!, 'shown');
            setLogo('shown');
          }}
          onError={() => {
            logos.set(firm!, 'none');
            setLogo('none');
          }}
          className="absolute inset-0 size-full opacity-0"
        />
      )}
    </Avatar>
  );
}
