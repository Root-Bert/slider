import type { SVGProps } from 'react';
import { iconPaths, type IconName } from './icon-paths';

export type { IconName };

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Rendered size in px (square). */
  size?: number;
  /** Accessible label. Without it the icon is treated as decorative. */
  label?: string;
}

export function Icon({ name, size = 24, label, ...props }: IconProps) {
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
      {...props}
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
