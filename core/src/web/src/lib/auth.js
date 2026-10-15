// Credentials exist only in the sign-in request. Session tokens are HttpOnly.
export const HOSTED = typeof document !== "undefined" && document.body.dataset.hosted === "true";
export const AUTH_EXPIRED = "fount:auth-expired";
let requests = new AbortController();
let epoch = 0;
export function abortRequests() {
  requests.abort();
  requests = new AbortController();
  epoch++;
}

// AbortSignal.any is missing before Safari 17.4, Firefox 124 and Chrome 116.
function anySignal(signals) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  const abort = (source) => controller.abort(source.reason);
  for (const source of signals) {
    if (source.aborted) {
      abort(source);
      break;
    }
    source.addEventListener("abort", () => abort(source), { once: true });
  }
  return controller.signal;
}

export async function apiFetch(url, options = {}) {
  const signals = [requests.signal, options.signal].filter(Boolean);
  const signal = signals.length === 1 ? signals[0] : anySignal(signals);
  const current = epoch;
  const response = await fetch(url, { ...options, credentials: "same-origin", signal });
  if (HOSTED && response.status === 401) {
    if (current === epoch) {
      abortRequests();
      window.dispatchEvent(new Event(AUTH_EXPIRED));
    }
    throw new Error("Your session ended. Sign in again.");
  }
  return response;
}

export async function authRequest(action, password, signal) {
  const response = await fetch(`/api/auth/${action}`, {
    method: action === "status" ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    ...(action === "login" ? { body: JSON.stringify({ password }) } : {}),
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not reach Fount. Check your connection and try again.");
  return data;
}
