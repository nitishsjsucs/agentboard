// Opaque keyset cursors: base64url(JSON) of the last row's sort key.

export function encodeCursor(key: Record<string, string | number>): string {
  return btoa(JSON.stringify(key)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCursor<T extends Record<string, string | number>>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    const padded = cursor.replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))) as T;
  } catch {
    return null;
  }
}
