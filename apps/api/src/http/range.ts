/** An inclusive byte range of a resource. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single-range `Range: bytes=…` header (RFC 9110 §14.1.2) against a resource of `size`
 * bytes. `null` means "send everything" (no or a multi-range header – both legal to ignore);
 * `'unsatisfiable'` means 416. Safari needs ranges to play audio and video at all.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return null;

  if (from === '') {
    // Suffix range: the last `to` bytes.
    const length = Number(to);
    if (length === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return 'unsatisfiable';
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}
