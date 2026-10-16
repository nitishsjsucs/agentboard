// Where the dev login sends the user back to, kept to this origin.

/** The dev login path, with `next` set to where the user was (left out for the dashboard). */
export function devLoginPath(pathAndQuery: string): string {
  return pathAndQuery === "/" || pathAndQuery === "" ? "/dev/login" : `/dev/login?next=${encodeURIComponent(pathAndQuery)}`;
}

/**
 * The path to go to after the dev login: `next` only when it is a same-origin path. Anything else
 * (an absolute URL, a protocol-relative "//host", a backslash trick, a relative path, the login page
 * itself) goes to the dashboard.
 */
export function safeNext(next: string | null, origin: string = window.location.origin): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin || url.pathname === "/dev/login") return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
