import { DetailedError, Upload } from 'tus-js-client';
import {
  API_PREFIX,
  CLOUD_TUS_PATH,
  CLOUD_UPLOAD_IN_PARTS_FROM,
  CLOUD_UPLOAD_PART_BYTES,
  type CloudUploadResult,
} from '@slider/shared';
import {
  accountHeader,
  ApiError,
  apiErrorFromText,
  apiRequest,
  unreachableError,
} from '@/lib/api-client';

/** Where an upload goes: a folder, an area's top, or (neither) one's own files. */
export interface UploadTarget {
  parentId?: string;
  areaId?: string;
  /** The new version of this file, whatever the picked file is called. */
  nodeId?: string;
}

export interface UploadRequest extends UploadTarget {
  workspaceId: string;
  file: File;
  /** Folders to make on the way – a dropped folder's own structure. */
  path?: string;
}

const paramsOf = ({ file, parentId, areaId, nodeId, path }: UploadRequest) => {
  const params: Record<string, string> = { name: file.name.normalize('NFC') };
  if (parentId) params.parentId = parentId;
  if (areaId) params.areaId = areaId;
  if (nodeId) params.nodeId = nodeId;
  if (path) params.path = path;
  return params;
};

/**
 * Sends one file: whole in one request, or – from `CLOUD_UPLOAD_IN_PARTS_FROM` – in parts over
 * tus, where a part that failed is sent again and the same file picked again goes on where it
 * stopped. `onProgress` gets the bytes sent so far.
 */
export function sendFile(
  request: UploadRequest,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
): Promise<CloudUploadResult> {
  return request.file.size >= CLOUD_UPLOAD_IN_PARTS_FROM
    ? sendInParts(request, onProgress, signal)
    : sendWhole(request, onProgress, signal);
}

/** XHR, not fetch: only it tells how much of the body has gone out. */
function sendWhole(
  request: UploadRequest,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
): Promise<CloudUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const query = new URLSearchParams(paramsOf(request));
    xhr.open(
      'POST',
      `${API_PREFIX}/workspaces/${encodeURIComponent(request.workspaceId)}/cloud/files?${query}`,
    );
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    for (const [name, value] of Object.entries(accountHeader())) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', request.file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onerror = () => reject(unreachableError());
    xhr.onabort = () => reject(new DOMException('Upload abgebrochen', 'AbortError'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as CloudUploadResult);
        } catch {
          reject(
            new ApiError(xhr.status, 'internal', 'Der Server hat unverständlich geantwortet.'),
          );
        }
      } else reject(apiErrorFromText(xhr.status, xhr.responseText));
    };
    if (signal.aborted) return xhr.abort();
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(request.file);
  });
}

const TUS_HEADERS = { 'Tus-Resumable': '1.0.0' };
const RETRY_DELAYS_MS = [0, 1000, 3000, 5000, 10_000];

async function sendInParts(
  request: UploadRequest,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
): Promise<CloudUploadResult> {
  const { file } = request;
  const metadata = {
    ...paramsOf(request),
    workspaceId: request.workspaceId,
    ...(file.type ? { filetype: file.type } : {}),
  };
  const fingerprint = ['slider-cloud', JSON.stringify(metadata), file.size, file.lastModified].join(
    ':',
  );
  const url = await new Promise<string>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `${API_PREFIX}${CLOUD_TUS_PATH}`,
      chunkSize: CLOUD_UPLOAD_PART_BYTES,
      retryDelays: RETRY_DELAYS_MS,
      headers: accountHeader(),
      metadata,
      fingerprint: async () => fingerprint,
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      onProgress: (sent) => onProgress(sent),
      onSuccess: () => resolve(upload.url ?? ''),
      onError: (error) => {
        const response = error instanceof DetailedError ? error.originalResponse : null;
        reject(response ? apiErrorFromText(response.getStatus(), response.getBody()) : error);
      },
    });
    const aborted = () => {
      // Cancelled by the person: what the server has of it goes too.
      void upload.abort(true);
      reject(new DOMException('Upload abgebrochen', 'AbortError'));
    };
    if (signal.aborted) return aborted();
    signal.addEventListener('abort', aborted, { once: true });
    void upload.findPreviousUploads().then((previous) => {
      if (signal.aborted) return;
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
  const id = url.split('/').pop() ?? '';
  let refused: ApiError | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      return await apiRequest<CloudUploadResult>(
        `${CLOUD_TUS_PATH}/${encodeURIComponent(id)}/finish`,
        { method: 'POST', headers: TUS_HEADERS, signal },
      );
    } catch (error) {
      // Refused the time before and gone by now: the refusal is the answer, not „gibt es nicht“.
      if (refused && error instanceof ApiError && error.status === 404) throw refused;
      // The answer lost on the way: the server keeps it, asking again is safe.
      const again = error instanceof ApiError && (error.status === 0 || error.status === 409);
      if (!again || attempt >= 5 || signal.aborted) throw error;
      if (error.status === 409) refused = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// ── What was dropped: files, and folders with everything in them ────────────

export interface PickedFile {
  file: File;
  /** The folders it lay in, `/`-separated; `''` for a file dropped by itself. */
  path: string;
}

/** Files nobody means to upload: what a desktop leaves in every folder. */
const NOISE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const wanted = (file: File) => !NOISE.has(file.name) && !file.name.startsWith('._');

const readAll = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => {
    const entries: FileSystemEntry[] = [];
    // A folder's entries come in batches; an empty one is the end.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(entries);
        entries.push(...batch);
        next();
      }, reject);
    next();
  });

async function walk(entry: FileSystemEntry, path: string, into: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    if (wanted(file)) into.push({ file, path });
    return;
  }
  const inside = await readAll((entry as FileSystemDirectoryEntry).createReader());
  const here = path ? `${path}/${entry.name}` : entry.name;
  for (const child of inside) await walk(child, here, into);
}

/** Everything of a drop – folders are walked through, each file keeps the path it lay at. */
/** Said when what was dropped could not be read (`droppedFiles` rejects). */
export const DROP_FAILED = 'Das ließ sich nicht lesen. Versuch es über „Hochladen“.';

export async function droppedFiles(transfer: DataTransfer): Promise<PickedFile[]> {
  // Read at once: the list is empty after the first `await`.
  const entries = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  const plain = [...transfer.files];
  if (entries.every((entry) => entry === null)) {
    return plain.filter(wanted).map((file) => ({ file, path: '' }));
  }
  const picked: PickedFile[] = [];
  for (const entry of entries) if (entry) await walk(entry, '', picked);
  return picked;
}

/** A folder picked in the file dialog (`webkitdirectory`): each file names its place in it. */
export const pickedFolderFiles = (files: FileList): PickedFile[] =>
  [...files].filter(wanted).map((file) => ({
    file,
    path: file.webkitRelativePath.split('/').slice(0, -1).join('/'),
  }));

/** Opens the system's file dialog; resolves with what was picked (nothing when it was closed). */
export function pickFromDisk(folder: boolean): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (folder) input.webkitdirectory = true;
    input.onchange = () => {
      const files = input.files;
      resolve(
        files
          ? folder
            ? pickedFolderFiles(files)
            : [...files].filter(wanted).map((file) => ({ file, path: '' }))
          : [],
      );
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}
