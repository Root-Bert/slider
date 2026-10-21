import { useState } from 'react';
import type { Workspace, WorkspaceUsageDetails } from '@slider/shared';
import { formatFileSize } from '@/lib/format';
import { useOnPageRestore } from '@/lib/page-restore';
import {
  useAcceptBillingTransfer,
  useCancelBillingTransfer,
  useMembers,
  useOpenBillingPortal,
  useRequestBillingTransfer,
  useStartCheckout,
} from '@/lib/api';
import { Button, cn, ErrorText, Legend, Notice, Section, Select, type ShowToast } from '@/ui';
import {
  deckState,
  downgradeMessage,
  formatPlanDate,
  nearLimit,
  pendingDowngrade,
  seatState,
  storageParts,
  storageState,
  unlimitedUsage,
} from '../lib/plan';
import { PlanBadge, UsageMeter } from './PlanUsage';

/**
 * "Nutzung" of one organisation (BER-151..155): plan, people, reviews and storage against the
 * plan's limits, warnings when it is (nearly) over them, and – with billing on – who pays and
 * the way to Stripe. Without billing and limits (self-hosting) only the numbers.
 */
export function UsageOverview({
  workspace,
  details,
  userId,
  onNotify,
}: {
  workspace: Pick<Workspace, 'id' | 'role'>;
  details: WorkspaceUsageDetails;
  userId: string;
  onNotify: ShowToast;
}) {
  const { usage, billing } = details;
  const selfHosted = !billing.enabled && unlimitedUsage(usage);
  return (
    <>
      <UsageWarnings details={details} isAdmin={workspace.role === 'admin'} />
      {!selfHosted && <PlanSection workspaceId={workspace.id} details={details} />}
      <Section
        title="Nutzung"
        description={
          usage.maxMembers === null
            ? undefined
            : 'Offene E-Mail-Einladungen halten einen Platz frei.'
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <UsageMeter label="Personen" state={seatState(usage)} />
          <UsageMeter
            label="Reviews"
            state={deckState(usage)}
            hint={usage.maxDecks !== null ? 'Archivierte zählen mit.' : undefined}
          />
        </div>
        <StorageMeter details={details} />
      </Section>
      {billing.enabled && (
        <BillingOwnerSection
          workspaceId={workspace.id}
          details={details}
          userId={userId}
          onNotify={onNotify}
        />
      )}
    </>
  );
}

/** Locked, about to fall back to free, or close to a limit – most urgent first, one at a time. */
function UsageWarnings({ details, isAdmin }: { details: WorkspaceUsageDetails; isAdmin: boolean }) {
  const { usage, billing } = details;
  if (details.locked) {
    return (
      <Notice
        tone="warning"
        variant="tinted"
        title="Die Organisation liegt über dem Limit ihres Plans"
      >
        Bis sie wieder hineinpasst, gehen keine neuen Reviews, Uploads und Importe, kein Abgleich
        mit der Quelldatei, keine Einladungen und keine neuen Kommentare oder Antworten. Lesen,
        Löschen und Personen entfernen geht weiter. Um das zu ändern: Personen entfernen oder
        Einladungen zurückziehen, Reviews oder Aufnahmen löschen – oder upgraden.
      </Notice>
    );
  }
  const downgradeAt = pendingDowngrade(billing);
  if (downgradeAt && (isAdmin || billing.isOwner)) {
    return (
      <Notice tone="warning" variant="tinted" title={downgradeMessage(downgradeAt)}>
        {billing.downgradeReason === 'payment_failed'
          ? 'Die letzte Zahlung hat nicht geklappt.'
          : 'Die Person, die bisher gezahlt hat, ist nicht mehr dabei.'}{' '}
        Danach gelten die Limits des Free-Plans.
      </Notice>
    );
  }
  const near = [
    nearLimit(seatState(usage)) && 'Personen',
    nearLimit(deckState(usage)) && 'Reviews',
    nearLimit(storageState(usage)) && 'Speicher',
  ].filter((label): label is string => Boolean(label));
  if (near.length === 0) return null;
  return (
    <Notice tone="info" variant="tinted" title="Bald am Limit">
      {near.join(', ')}: fast ausgeschöpft. Ist ein Limit überschritten, gehen neue Reviews,
      Uploads, Einladungen und Kommentare nicht mehr.
    </Notice>
  );
}

/** Plan badge, renewal or end, and the way to Stripe for the billing owner. */
function PlanSection({
  workspaceId,
  details,
}: {
  workspaceId: string;
  details: WorkspaceUsageDetails;
}) {
  const { billing, usage } = details;
  const paid = details.plan === 'paid';
  const limits = [
    usage.maxMembers !== null && `${usage.maxMembers} Personen`,
    usage.maxDecks !== null && `${usage.maxDecks} Reviews`,
    usage.maxStorageBytes !== null && `${formatFileSize(usage.maxStorageBytes)} Speicher`,
  ].filter((part): part is string => Boolean(part));
  const description = billing.granted
    ? 'Freigeschaltet von der Person, die Slider hier betreibt. Hier gibt es nichts zu bezahlen.'
    : billing.endsAt
      ? `Endet am ${formatPlanDate(billing.endsAt)}.`
      : billing.trialEndsAt
        ? `Testphase bis ${formatPlanDate(billing.trialEndsAt)}. Ohne Zahlungsmethode geht es danach mit Free weiter.`
        : billing.renewsAt
          ? `Verlängert sich am ${formatPlanDate(billing.renewsAt)}.`
          : limits.length > 0
            ? `Bis zu ${limits.join(', ')}.`
            : undefined;
  return (
    <Section title="Plan" description={description} aside={<PlanBadge plan={details.plan} />}>
      {billing.enabled &&
        !billing.granted &&
        (billing.isOwner ? (
          <BillingActions
            workspaceId={workspaceId}
            // Paid without a subscription: the paying admin changed and nobody added a card yet.
            action={
              !paid
                ? billing.trialAvailable
                  ? 'trial'
                  : 'upgrade'
                : billing.trialEndsAt
                  ? 'trialPayment'
                  : billing.status
                    ? 'portal'
                    : 'payment'
            }
          />
        ) : (
          billing.owner && (
            <p className="text-body text-fg-subtle">
              {paid ? 'Zahlung' : 'Upgrade'} über {billing.owner.name}
            </p>
          )
        ))}
    </Section>
  );
}

const ACTION_LABELS = {
  trial: '14 Tage kostenlos testen',
  upgrade: 'Upgraden',
  portal: 'Zahlung verwalten',
  payment: 'Zahlungsmethode hinterlegen',
  // During the trial the card goes in through the customer portal.
  trialPayment: 'Zahlungsmethode hinterlegen',
} as const;

/** Actions that open the customer portal; the rest go through checkout. */
const PORTAL_ACTIONS: ReadonlySet<keyof typeof ACTION_LABELS> = new Set(['portal', 'trialPayment']);

/** Checkout (upgrade, add a payment method) or the customer portal – both Stripe pages. */
function BillingActions({
  workspaceId,
  action,
}: {
  workspaceId: string;
  action: keyof typeof ACTION_LABELS;
}) {
  const checkout = useStartCheckout(workspaceId);
  const portal = useOpenBillingPortal(workspaceId);
  const mutation = PORTAL_ACTIONS.has(action) ? portal : checkout;
  useOnPageRestore(() => {
    checkout.reset();
    portal.reset();
  });
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant={action === 'portal' ? 'secondary' : 'primary'}
        trailingIcon="arrowForward"
        // Stays busy until the browser has left for Stripe.
        loading={mutation.isPending || mutation.isSuccess}
        onClick={() =>
          mutation.mutate(undefined, { onSuccess: ({ url }) => window.location.assign(url) })
        }
      >
        {ACTION_LABELS[action]}
      </Button>
      {action === 'trial' && (
        <p className="text-caption text-fg-subtle">Alles aus Paid, ohne Zahlungsmethode.</p>
      )}
      {mutation.isError && (
        <ErrorText role="alert" size="xs">
          {mutation.error.message}
        </ErrorText>
      )}
    </div>
  );
}

/** "1,2 GB von 2 GB": one bar split by kind of file, with a legend. */
function StorageMeter({ details }: { details: WorkspaceUsageDetails }) {
  const { usage, storage } = details;
  const state = storageState(usage);
  const total = usage.maxStorageBytes ?? usage.storageBytes;
  const parts = storageParts(storage).filter((part) => part.amount > 0);
  return (
    <div className="flex flex-col gap-3 rounded-panel bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body text-fg-muted">Speicher</span>
        <span className={cn('text-sm tabular-nums', state.full ? 'text-warning' : 'text-fg')}>
          {usage.maxStorageBytes === null
            ? `${formatFileSize(usage.storageBytes)} | unbegrenzt`
            : `${formatFileSize(usage.storageBytes)} von ${formatFileSize(usage.maxStorageBytes)}`}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Speicher"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={usage.storageBytes}
        aria-valuetext={`${formatFileSize(usage.storageBytes)}${usage.maxStorageBytes === null ? '' : ` von ${formatFileSize(usage.maxStorageBytes)}`}`}
        className="flex h-2 overflow-hidden rounded-full bg-hover"
      >
        {total > 0 &&
          parts.map((part) => (
            <div
              key={part.key}
              className={part.color}
              style={{ width: `${Math.min(100, (part.amount / total) * 100)}%` }}
            />
          ))}
      </div>
      {parts.length === 0 ? (
        <p className="text-xs text-fg-subtle">Noch nichts gespeichert.</p>
      ) : (
        <Legend label="Speicher nach Art" size="sm" items={parts} />
      )}
    </div>
  );
}

/**
 * "Zahlung": who pays (BER-154). The billing owner hands over to another admin – effective once
 * they pay; the asked admin accepts (to Stripe for their payment method) or declines.
 */
function BillingOwnerSection({
  workspaceId,
  details,
  userId,
  onNotify,
}: {
  workspaceId: string;
  details: WorkspaceUsageDetails;
  userId: string;
  onNotify: ShowToast;
}) {
  const { billing } = details;
  const asked = billing.transfer?.to.id === userId;
  const ownerLine = !billing.owner
    ? 'Gerade zahlt niemand für diese Organisation.'
    : billing.isOwner
      ? 'Du zahlst für diese Organisation.'
      : `${billing.owner.name} zahlt für diese Organisation.`;
  return (
    <Section
      title="Zahlung"
      description={`${ownerLine} Rechnungen und Zahlungsmethode sieht nur diese Person.`}
    >
      {asked && billing.transfer ? (
        <TransferRequest
          workspaceId={workspaceId}
          ownerName={billing.owner?.name ?? 'Jemand'}
          onNotify={onNotify}
        />
      ) : (
        billing.isOwner &&
        (billing.transfer ? (
          <PendingTransfer
            workspaceId={workspaceId}
            toName={billing.transfer.to.name}
            onNotify={onNotify}
          />
        ) : (
          <HandOver workspaceId={workspaceId} userId={userId} onNotify={onNotify} />
        ))
      )}
    </Section>
  );
}

/** The asked admin: "Anna bittet dich, die Zahlung zu übernehmen" – Übernehmen / Ablehnen. */
function TransferRequest({
  workspaceId,
  ownerName,
  onNotify,
}: {
  workspaceId: string;
  ownerName: string;
  onNotify: ShowToast;
}) {
  const accept = useAcceptBillingTransfer(workspaceId);
  const decline = useCancelBillingTransfer(workspaceId);
  useOnPageRestore(accept.reset);
  const onError = (error: Error) => onNotify(error.message, 'danger');
  return (
    <Notice
      tone="info"
      variant="tinted"
      size="sm"
      icon={false}
      title={`${ownerName} bittet dich, die Zahlung zu übernehmen`}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            // Stays busy until the browser has left for Stripe.
            loading={accept.isPending || Boolean(accept.data?.url)}
            disabled={decline.isPending}
            onClick={() =>
              accept.mutate(undefined, {
                onSuccess: ({ url }) =>
                  url
                    ? window.location.assign(url)
                    : onNotify('Du zahlst jetzt für diese Organisation.'),
                onError,
              })
            }
          >
            Übernehmen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={decline.isPending}
            disabled={accept.isPending}
            onClick={() =>
              decline.mutate(undefined, { onSuccess: () => onNotify('Abgelehnt'), onError })
            }
          >
            Ablehnen
          </Button>
        </div>
      }
    >
      Bei einer bezahlten Organisation hinterlegst du danach deine Zahlungsmethode.
    </Notice>
  );
}

/** The billing owner's open request – it counts once the other admin accepts. */
function PendingTransfer({
  workspaceId,
  toName,
  onNotify,
}: {
  workspaceId: string;
  toName: string;
  onNotify: ShowToast;
}) {
  const cancel = useCancelBillingTransfer(workspaceId);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-body text-fg-subtle">
        Du hast {toName} gebeten, die Zahlung zu übernehmen.
      </p>
      <Button
        size="sm"
        variant="secondary"
        loading={cancel.isPending}
        onClick={() =>
          cancel.mutate(undefined, {
            onSuccess: () => onNotify('Anfrage zurückgezogen'),
            onError: (error) => onNotify(error.message, 'danger'),
          })
        }
      >
        Zurückziehen
      </Button>
    </div>
  );
}

/** The billing owner picks another admin to pay from now on. */
function HandOver({
  workspaceId,
  userId,
  onNotify,
}: {
  workspaceId: string;
  userId: string;
  onNotify: ShowToast;
}) {
  const members = useMembers(workspaceId);
  const request = useRequestBillingTransfer(workspaceId);
  const admins = (members.data ?? []).filter(
    (member) => member.role === 'admin' && member.userId !== userId,
  );
  const [picked, setPicked] = useState('');
  const target = admins.find((admin) => admin.userId === picked) ?? admins[0];
  if (!members.isSuccess) return null;
  if (!target) {
    return (
      <p className="text-body text-fg-subtle">
        Übergeben kannst du an andere Admins – gerade gibt es keine weiteren.
      </p>
    );
  }
  const handOver = () =>
    request.mutate(target.userId, {
      // A free organisation changes hands at once; a paid one once the other admin pays.
      onSuccess: (result) =>
        onNotify(
          result.billing.owner?.id === target.userId
            ? `${target.name} zahlt jetzt für diese Organisation`
            : `Anfrage an ${target.name} geschickt`,
        ),
      onError: (error) => onNotify(error.message, 'danger'),
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select<string>
        aria-label="Admin, der die Zahlung übernimmt"
        value={target.userId}
        onChange={setPicked}
        options={admins.map((admin) => ({ value: admin.userId, label: admin.name }))}
        className="min-w-[200px]"
      />
      <Button variant="secondary" loading={request.isPending} onClick={handOver}>
        Zahlung übergeben
      </Button>
    </div>
  );
}
