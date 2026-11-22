import { useLegalTexts } from '@/lib/api';
import { routes } from '@/lib/routes';
import { cn, TextLink } from '@/ui';

/**
 * "Impressum | Datenschutz" (BER-141) under every public page and in the settings – only the
 * texts the instance admin has written – and the credit the mail avatars' licence asks for.
 */
export function LegalLinks({ className }: { className?: string }) {
  const texts = useLegalTexts().data;
  const links = [
    texts?.imprint ? { to: routes.imprint(), label: 'Impressum' } : null,
    texts?.privacy ? { to: routes.privacy(), label: 'Datenschutz' } : null,
  ].filter((link) => link !== null);
  return (
    <nav
      aria-label="Rechtliches"
      className={cn('flex flex-wrap justify-center gap-3 text-xs text-fg-subtle', className)}
    >
      {links.map((link) => (
        <TextLink key={link.to} to={link.to}>
          {link.label}
        </TextLink>
      ))}
      {/* CC BY 4.0 asks for the credit where it is seen: the mail avatars (generated-avatar.ts). */}
      <TextLink
        href="https://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noreferrer"
      >
        Mail-Avatare „Glyphs“ von Matt Houser, CC BY 4.0
      </TextLink>
    </nav>
  );
}
