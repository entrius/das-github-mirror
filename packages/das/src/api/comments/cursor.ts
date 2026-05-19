// Opaque cursor pagination shared by the comments / review-comments /
// label-events endpoints. The cursor encodes a (timestamp, id) tuple as
// base64-encoded JSON. Rows are ordered by (timestamp ASC, id ASC) and a
// keyset predicate `(ts, id) > (cursorTs, cursorId)` selects the next page.

export interface CursorPayload {
  t: string;
  i: string | number;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function clampLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export function decodeCursor(raw: string | undefined): CursorPayload | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as CursorPayload;
    if (typeof parsed.t !== "string") return null;
    if (typeof parsed.i !== "string" && typeof parsed.i !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
