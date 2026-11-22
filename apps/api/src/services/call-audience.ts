/**
 * Who sees a workspace's conversations may have shrunk – one left a group, was taken out of an
 * area or the workspace: its calls ask anew who sees them (`CallHub.freshenIn`), so one taken out
 * is out of a quiet call at once, not only at its next event. Apart from `calls.ts`, which
 * imports Sender: Sender, Cloud and the workspaces tell it without knowing the calls.
 */
interface Hears {
  freshenIn(workspaceId: string): void;
}

/** The hubs of this process (one per app – tests make many), held weakly. */
const hubs = new Set<WeakRef<Hears>>();

export function hearAudiences(hub: Hears): void {
  hubs.add(new WeakRef(hub));
}

export function audienceShrank(workspaceId: string): void {
  for (const ref of hubs) {
    const hub = ref.deref();
    if (hub) hub.freshenIn(workspaceId);
    else hubs.delete(ref);
  }
}
