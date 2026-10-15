import { AvatarStack, cn } from '@/ui';
import { useLivePeople } from './live-people';

/** Who has this slide active right now: small avatars in the slide's top-right corner (BER-104). */
export function LiveSlidePresence({ slideId, small }: { slideId: string; small: boolean }) {
  const here = useLivePeople().filter((person) => person.activeSlideId === slideId);
  if (here.length === 0) return null;
  return (
    <div
      className={cn(
        'pointer-events-auto absolute animate-fade-in',
        small ? 'top-1 right-1' : 'top-3 right-3',
      )}
    >
      <AvatarStack
        authors={here.map((person) => person.author)}
        size={small ? 16 : 24}
        max={small ? 2 : 4}
        interactive={!small}
      />
    </div>
  );
}
