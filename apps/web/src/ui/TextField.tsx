import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible label. Use `aria-label` instead when the context already labels the field. */
  label?: string;
  icon?: IconName;
  error?: string | null;
  hint?: string;
  trailing?: ReactNode;
  size?: 'md' | 'lg';
  ref?: Ref<HTMLInputElement>;
}

/** UI kit "Input": glass field with optional leading icon, error state and message. */
export function TextField({
  label,
  icon,
  error,
  hint,
  trailing,
  size = 'md',
  className,
  id,
  ref,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={inputId} className="text-xs text-fg-subtle">
          {label}
        </label>
      )}
      <div
        className={cn(
          'glass flex items-center gap-3 rounded-control px-3 transition-shadow',
          'focus-within:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]',
          size === 'lg' ? 'h-11' : 'h-10',
          error && 'shadow-[inset_0_0_0_1px_var(--color-danger)]!',
        )}
      >
        {icon && <Icon name={icon} size={20} className="shrink-0 text-fg-subtle" />}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          {...props}
        />
        {trailing}
      </div>
      {message && (
        <p id={messageId} className={cn('text-xs', error ? 'text-danger' : 'text-fg-subtle')}>
          {message}
        </p>
      )}
    </div>
  );
}
