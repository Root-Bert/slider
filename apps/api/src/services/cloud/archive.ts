import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { cloudFreeName, cloudNameKey } from '@slider/shared';
import type { CloudNodeRow } from '../../db/schema';
import { ApiError } from '../../http/errors';
import type { CloudDeps } from './context';
import { versionToServe } from './files';
import { descendantsOf } from './tree';

/**
 * Several files and folders as one ZIP, written while it is sent: each file is read from
 * storage as the archive reaches it, stored as it is (no compression – most of what people keep
 * is compressed already), so nothing is held whole.
 */

/** A classic ZIP holds 4 GB; more would need ZIP64, which the library does not write. */
const MAX_ARCHIVE_BYTES = 4 * 1024 ** 3 - 64 * 1024 ** 2;
const MAX_ARCHIVE_FILES = 20_000;

export const archiveTooLarge = () =>
  new ApiError(
    413,
    'file_too_large',
    'Das sind mehr als 4 GB – als ZIP geht das nicht. Lade die Ordner einzeln.',
  );

/** A name as one step of a path in the ZIP: never a way up or down (names from before the rule). */
const pathPart = (name: string) => {
  const plain = [...name].map((char) => (char < ' ' || char === '/' || char === '\\' ? '-' : char));
  return /^\.+$/.test(name) ? '-' : plain.join('');
};

/** The ZIP of `roots` (files, and folders with everything living in them) as a stream. */
export async function archiveOf(
  deps: CloudDeps,
  roots: readonly CloudNodeRow[],
): Promise<ReadableStream<Uint8Array>> {
  const zip = new JSZip();
  const taken = new Set<string>();
  const paths = new Map<string, string>();
  for (const root of roots) {
    const name = cloudFreeName(pathPart(root.name), taken);
    taken.add(cloudNameKey(name));
    paths.set(root.id, name);
  }
  const inside = await descendantsOf(
    deps.db,
    roots.filter((root) => root.kind === 'folder').map((root) => root.id),
  );
  const entries = [...roots, ...inside];
  const files = entries.filter((entry) => entry.kind === 'file');
  const bytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (bytes > MAX_ARCHIVE_BYTES || files.length > MAX_ARCHIVE_FILES) throw archiveTooLarge();
  // `descendantsOf` goes level by level: a parent's path is there before its children ask.
  for (const entry of inside) {
    const parent = paths.get(entry.parentId ?? '');
    if (parent) paths.set(entry.id, `${parent}/${pathPart(entry.name)}`);
  }
  for (const entry of entries) {
    const path = paths.get(entry.id);
    if (!path) continue;
    if (entry.kind === 'folder') {
      zip.folder(path);
      continue;
    }
    const version = await versionToServe(deps, entry).catch(() => null);
    if (!version) continue;
    // Opened only when the archive gets to it – never thousands of files at once.
    const lazy = Readable.from(
      (async function* () {
        const stream = await deps.storage.stream(version.storageKey);
        if (!stream) return;
        const reader = stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      })(),
    );
    zip.file(path, lazy, { date: entry.updatedAt, compression: 'STORE' });
  }
  // The library's own stream, handed on as it writes: paused while the reader is behind.
  const out = zip.generateInternalStream({
    type: 'uint8array',
    streamFiles: true,
    compression: 'STORE',
  });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      out
        .on('data', (chunk: Uint8Array) => {
          controller.enqueue(chunk);
          if ((controller.desiredSize ?? 1) <= 0) out.pause();
        })
        .on('error', (error: Error) => controller.error(error))
        .on('end', () => controller.close());
      out.resume();
    },
    pull() {
      out.resume();
    },
    cancel() {
      out.pause();
    },
  });
}
