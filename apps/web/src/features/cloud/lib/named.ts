import type { CloudAgentDetail } from '@slider/shared';
import { routes } from '@/lib/routes';

/** What an answer names with a link: `[[file:id|Name]]`, folders, areas and presentations alike. */
// The end also as „]}“: the model slips there now and then, and the id would show bare.
export const NAMED = /\[\[(file|folder|area|presentation):([0-9a-f-]{36})\|([^\]\n}]+)\][\]}]/g;
export type NamedKind = 'file' | 'folder' | 'area' | 'presentation';
export interface Named {
  kind: NamedKind;
  id: string;
  name: string;
}

export const namedIn = (text: string): Named[] =>
  [...text.matchAll(NAMED)].map((match) => ({
    kind: match[1] as NamedKind,
    id: match[2]!,
    name: match[3]!.trim(),
  }));

/** As it is copied: the names, without the marks around them. */
export const plainNamed = (text: string) => text.replace(NAMED, '$3');

/** All the answers named, newest first, each once. */
export function namedBy(agent: CloudAgentDetail): Named[] {
  const seen = new Set<string>();
  return agent.chats
    .flatMap((chat) => chat.messages)
    .filter((each) => each.role === 'assistant')
    .reverse()
    .flatMap((each) => namedIn(each.text))
    .filter((named) => !seen.has(named.id) && seen.add(named.id));
}

/**
 * Where a file opens from a link, as Cloud opens it: a PDF in Reader, a document in Writer –
 * where it is read and written –, a diagram where it is drawn, anything else as its details in Cloud.
 */
export const fileHref = (workspaceId: string, file: { id: string; name: string }) =>
  /\.pdf$/i.test(file.name)
    ? routes.pdf(file.id)
    : /\.odt$/i.test(file.name)
      ? routes.document(file.id)
      : /\.(md|markdown)$/i.test(file.name)
        ? routes.cloudPage(workspaceId, file.id)
        : /\.diagram$/i.test(file.name)
          ? routes.diagram(file.id)
          : routes.cloudFile(workspaceId, file.id);

/** Where what an answer named opens: a file in its app (`fileHref`), the rest as its page. */
export const namedHref = (workspaceId: string, named: Named) =>
  named.kind === 'file'
    ? fileHref(workspaceId, named)
    : named.kind === 'folder'
      ? routes.cloudFolder(workspaceId, named.id)
      : named.kind === 'area'
        ? routes.cloudArea(workspaceId, named.id)
        : routes.deck(named.id);
