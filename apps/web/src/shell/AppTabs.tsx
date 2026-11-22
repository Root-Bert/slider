import { GlassPanel, SegmentedControl, type IconName } from '@/ui';

/**
 * The button group at the top of the pages that speak for every app (settings, usage, the
 * instance): the whole, or one app's part.
 */
export function AppTabs<T extends string>({
  label,
  value,
  onChange,
  segments,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  segments: readonly { value: T; label: string; icon?: IconName }[];
}) {
  return (
    <GlassPanel className="flex items-center self-start p-1">
      <SegmentedControl<T>
        label={label}
        mode="tabs"
        value={value}
        onChange={onChange}
        segments={segments}
      />
    </GlassPanel>
  );
}
