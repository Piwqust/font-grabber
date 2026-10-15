import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { AUTH_EXPIRED, HOSTED, abortRequests, authRequest } from "../lib/auth.js";
import { clearPrivateSession } from "../lib/storage.js";
import { resetPreviews } from "../lib/previews.js";
import { Button } from "../ui/Button.jsx";
import { Field } from "../ui/Field.jsx";
import { Mark } from "../ui/Logo.jsx";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthGate({ children }) {
  const [phase, setPhase] = useState(HOSTED ? "checking" : "open");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef(null);
  const channel = useRef(null);
  const expires = useRef(null);
  const loginFocus = useRef(false);

  const lock = (message = "") => {
    abortRequests();
    resetPreviews();
    clearPrivateSession();
    setPhase("locked");
    setError(message);
    setBusy(false);
  };
  expires.current = lock;

  useEffect(() => {
    if (!HOSTED) return;
    const controller = new AbortController();
    authRequest("status", undefined, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      if (data.authenticated) setPhase("open");
      else lock();
    }).catch((err) => { if (!controller.signal.aborted) lock(err.message); });
    const expired = () => expires.current("Your session ended. Sign in again.");
    window.addEventListener(AUTH_EXPIRED, expired);
    try {
      channel.current = new BroadcastChannel("fount-auth");
      channel.current.onmessage = () => expires.current("You signed out in another tab.");
    } catch { /* Focus/status checks still work when channels are unavailable. */ }
    return () => {
      controller.abort();
      window.removeEventListener(AUTH_EXPIRED, expired);
      channel.current?.close();
    };
  }, []);

  useEffect(() => {
    if (phase !== "open" || !HOSTED) return;
    const controller = new AbortController();
    const check = () => authRequest("status", undefined, controller.signal).then((data) => {
      if (!controller.signal.aborted && !data.authenticated) expires.current("Your session ended. Sign in again.");
    }).catch(() => {});
    window.addEventListener("focus", check);
    const timer = setInterval(check, 60000);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", check); };
  }, [phase]);

  useEffect(() => {
    if (phase === "locked") field.current?.focus();
    if (phase === "open" && loginFocus.current) {
      loginFocus.current = false;
      requestAnimationFrame(() => document.getElementById("url")?.focus());
    }
  }, [phase]);

  const login = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const password = field.current.value;
    field.current.value = "";
    try {
      await authRequest("login", password);
      loginFocus.current = true;
      setPhase("open");
    } catch (err) { setError(err.message); field.current?.focus(); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    // lock() aborts in-flight work, and only once the sign-out has succeeded:
    // a failed sign-out leaves the person signed in with their work intact.
    try {
      await authRequest("logout");
      channel.current?.postMessage("logout");
      lock();
    } catch { setError("Could not sign out. Check your connection and try again."); }
    finally { setBusy(false); }
  };

  if (phase === "open") return (
    <AuthContext.Provider value={HOSTED ? { logout, busy } : null}>
      {error ? <p class="auth-notice" role="alert">{error}</p> : null}
      {children}
    </AuthContext.Provider>
  );

  return <div class="auth-page">
    <header class="auth-brand"><Mark size={30} /><span>Fount</span><span class="auth-edition">Private workspace</span></header>
    <main class="auth-main">
      <p class="auth-eyebrow">Find. Compare. Make it yours.</p>
      <h1>Your type,<br /><em>behind one door.</em></h1>
      <p class="auth-description">Sign in to discover website fonts and customize their metadata.</p>
      {phase === "checking" ? <p role="status">Checking your session…</p> :
        <form class="auth-form" onSubmit={login} aria-busy={busy}>
          <Field ref={field} id="fount-password" label="Password" name="password"
            type="password" autocomplete="current-password" required maxLength={1024}
            invalid={!!error} aria-describedby={error ? "auth-error" : undefined} />
          <Button type="submit" full variant="solid" busy={busy}>Sign in</Button>
          <p id="auth-error" class="auth-error" role="alert">{error}</p>
        </form>}
    </main>
    <footer class="auth-footer">Website fonts &amp; font metadata</footer>
  </div>;
}
