import { useState } from 'react';
import { cloudFileType, type CloudAgentFile, type CloudFileType } from '@slider/shared';
import { cn, Icon } from '@/ui';
import { FILE_KINDS } from '../lib/kinds';
import { FileIcon } from './FileIcon';

/** A thing on an agent's desk, as far as its picture needs it. */
export type DeskThing = Pick<CloudAgentFile, 'name' | 'kind' | 'nodeId' | 'thumbnailUrl'>;

/** What kind of file it is: a presentation by what the agent did, the rest by its name. */
const deskFileType = (file: Pick<DeskThing, 'name' | 'kind'>): CloudFileType =>
  file.kind === 'deck' || file.kind === 'deck-change' ? 'presentation' : cloudFileType(file.name);

/**
 * The picture there is of it, as the server names it (`thumbnailUrl`): a presentation's first
 * slide, or the small picture of the file it is about – a file the agent made too, once that
 * picture is drawn.
 */
const pictureOf = (file: DeskThing): string | null => file.thumbnailUrl;

/** Its symbol as the files show it – a folder's for a new folder. */
export function DeskIcon({ file, size = 20 }: { file: DeskThing; size?: 20 | 32 | 56 }) {
  return file.kind === 'folder' ? (
    <FileIcon kind="folder" type={null} size={size} />
  ) : (
    <FileIcon kind="file" type={deskFileType(file)} size={size} />
  );
}

/**
 * A desk thing as a sheet, the way a folder's files peek out of it: its small picture, else its
 * kind's colour and symbol.
 */
export function DeskSheet({ file, className }: { file: DeskThing; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : pictureOf(file);
  const look = FILE_KINDS[deskFileType(file)];
  return (
    <span
      className={cn(
        'block overflow-hidden rounded-control-sm bg-surface-1 shadow-mark ring-1 ring-black/10',
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover object-top"
        />
      ) : (
        <span className={cn('flex size-full items-start gap-1.5 p-2', look.tile, look.ink)}>
          <Icon name={file.kind === 'folder' ? 'folder' : look.icon} size={14} />
          <span className="mt-1 h-1 w-10 max-w-[50%] rounded-full bg-current opacity-40" />
        </span>
      )}
    </span>
  );
}

/** The picture in a tile, as a file's: the top of its first page lying on it, else its symbol. */
export function DeskPicture({ file }: { file: DeskThing }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : pictureOf(file);
  return src ? (
    <span className="block size-full overflow-hidden px-[14%] pt-[9%]">
      <img
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        className="w-full rounded-t-thumb shadow-float"
      />
    </span>
  ) : (
    <span className="flex size-full items-center justify-center">
      <DeskIcon file={file} size={56} />
    </span>
  );
}
