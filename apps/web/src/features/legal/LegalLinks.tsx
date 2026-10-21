import { useLegalTexts } from '@/lib/api';
import { routes } from '@/lib/routes';
import { cn, TextLink } from '@/ui';

/**
 * "Impressum | Datenschutz" (BER-141) under every public page and in the settings – only the
 * texts the instance admin has written.
 */
export function LegalLinks({ className }: { className?: string }) {
  const texts = useLegalTexts().data;
  const links = [
    texts?.imprint ? { to: routes.imprint(), label: 'Impressum' } : null,
    texts?.privacy ? { to: routes.privacy(), label: 'Datenschutz' } : null,
  ].filter((link) => link !== null);
  if (links.length === 0) return null;
  return (
    <nav
      aria-label="Rechtliches"
      className={cn('flex justify-center gap-3 text-xs text-fg-subtle', className)}
    >
      {links.map((link) => (
        <TextLink key={link.to} to={link.to}>
          {link.label}
        </TextLink>
      ))}
    </nav>
  );
}
