// Future boundary only. The current popup deliberately selects the local engine.
// Hosted mode must not silently upload page data or fall back after an auth failure.
export const DEFAULT_FOUNT_ORIGIN = "https://fount.angleford.co";
export function selectBackend(local, { mode = "local", hosted = null } = {}) {
  if (mode === "local") return local;
  if (mode !== "hosted" || !hosted) throw new Error("Hosted extension mode has not been configured.");
  return hosted;
}

// Transport for a future website handoff/adapter. A page in the Fount origin can
// use its HttpOnly cookie; an extension-origin request cannot use SameSite=Strict.
// Do not loosen cookies/CORS here. Pairing and consent need a separate implementation.
export function createHostedClient({ origin = DEFAULT_FOUNT_ORIGIN, transport }) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password)
    throw new Error("Use an HTTPS Fount origin without a path.");
  if (typeof transport !== "function") throw new Error("A paired Fount transport is required.");
  async function request(path, body) {
    if (!path.startsWith("/api/") || path.includes("..")) throw new Error("Invalid Fount API path.");
    let response;
    try { response = await transport(origin + path, body); }
    catch { throw Object.assign(new Error("Fount is unavailable. Check the connection."), { code: "unavailable" }); }
    if (response.status === 401) throw Object.assign(new Error("Sign in to Fount again."), { code: "unauthorized" });
    if (response.status === 429) throw Object.assign(new Error("Fount is busy. Try again shortly."), { code: "busy" });
    if (!response.ok) throw Object.assign(new Error("Fount could not finish this request."), { code: "request_failed" });
    return response;
  }
  return { origin, request, auth: { status: () => request("/api/auth/status"), logout: () => request("/api/auth/logout", {}) } };
}
