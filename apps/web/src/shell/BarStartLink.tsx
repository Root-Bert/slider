import { NavLink } from 'react-router';
import { buttonClasses, cn, Icon } from '@/ui';

/**
 * A side bar's start as its first button, beside „Neu“ – Cloud's „Zuletzt“, Sender's
 * „Aktuell“: the ink of the bar, the same from every page. `away`: on a page that stands over it
 * (`?neu=`) it is not where one is. Folded (`lg`), only its icon.
 */
export function BarStartLink({
  to,
  label,
  away = false,
  folded = false,
}: {
  to: string;
  label: string;
  away?: boolean;
  folded?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end
      title={folded ? label : undefined}
      aria-label={folded ? label : undefined}
      {...(away ? { 'aria-current': false as const } : {})}
      className={cn(
        buttonClasses({ variant: 'primary', size: 'md' }),
        'min-w-0 flex-1',
        folded && 'lg:w-[38px] lg:flex-none lg:gap-0 lg:px-0',
      )}
    >
      <Icon name="home" size={18} />
      <span className={cn('truncate', folded && 'lg:hidden')}>{label}</span>
    </NavLink>
  );
}
