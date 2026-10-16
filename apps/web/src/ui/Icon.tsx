import type { SVGProps } from 'react';
import { cn } from './cn';
import { iconPaths, type IconName } from './icon-paths';

export type { IconName };

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Rendered size in px (square). */
  size?: number;
  /** Accessible label. Without it the icon is treated as decorative. */
  label?: string;
}

export function Icon({ name, size = 24, label, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      // Never squeezed by a flex row whose label runs out of room.
      className={cn('shrink-0', className)}
      {...props}
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
