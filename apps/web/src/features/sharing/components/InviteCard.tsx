import { useNavigate } from 'react-router';
import type { InviteInfo, Viewer } from '@slider/shared';
import { routes } from '@/app/routes';
import { useMe } from '@/lib/queries';
import { AvatarStack, Button, Icon } from '@/ui';
import { SlideThumbnail } from '@/features/reviews/components/SlideThumbnail';
import { slidesLabel } from '@/features/reviews/lib/deck-labels';
import { firstName, participantsSentence } from '../lib/participants-sentence';
import { JoinForm } from './JoinForm';

export function InviteCard({ token, invite }: { token: string; invite: InviteInfo }) {
  const { data: me } = useMe();
  const returningGuest = me && isGuestOf(me.viewer, invite) ? me.viewer : null;
  // The inviting owner is implied by the headline; list the other reviewers only.
  const reviewers = invite.participants.filter((person) => person.type !== 'owner');
  const sentence = participantsSentence(reviewers);

  return (
    <div className="flex flex-col gap-4">
      <title>{`Einladung: ${invite.deckTitle} · Slider`}</title>
      <figure className="flex flex-col items-center gap-2">
        <SlideThumbnail
          src={invite.thumbnailUrl}
          className="w-36 rounded-[8px] ring-1 ring-hairline-strong"
        />
        <figcaption className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <Icon name={invite.role === 'view' ? 'lock' : 'chatBubble'} size={14} />
          {invite.deckTitle} · {slidesLabel(invite.slideCount)} ·{' '}
          {invite.role === 'view' ? 'nur lesen' : 'Kommentieren erlaubt'}
        </figcaption>
      </figure>

      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-lg leading-snug font-semibold text-balance text-fg">
          {firstName(invite.ownerName)} hat dich zum Review von „{invite.deckTitle}“ eingeladen
        </h1>
        <p className="text-[13px] text-fg-subtle">
          {invite.role === 'view'
            ? 'Sieh dir die Folien an – ohne Account.'
            : 'Markiere Folien und kommentiere direkt – ohne Account.'}
        </p>
      </div>

      {returningGuest && <ContinueAsGuest viewer={returningGuest} />}
      <JoinForm token={token} />

      {sentence && (
        <>
          <div className="h-px bg-hairline" />
          <div className="flex items-center justify-center gap-2.5">
            <AvatarStack authors={reviewers} max={4} size={24} />
            <p className="text-xs text-fg-subtle">{sentence}</p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * `InviteInfo` carries no deck id, so a returning guest is recognised by being one of the
 * deck's participants (guests become participants when they join).
 */
const isGuestOf = (
  viewer: Viewer,
  invite: InviteInfo,
): viewer is Extract<Viewer, { kind: 'guest' }> =>
  viewer.kind === 'guest' && invite.participants.some((person) => person.id === viewer.author.id);

function ContinueAsGuest({ viewer }: { viewer: Extract<Viewer, { kind: 'guest' }> }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      size="lg"
      icon="arrowForward"
      onClick={() => void navigate(routes.deck(viewer.deckId))}
    >
      Weiter als {viewer.author.name}
    </Button>
  );
}
