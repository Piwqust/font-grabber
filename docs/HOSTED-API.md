# Private Fount API

The local web edition remains unauthenticated on loopback. `serve --hosted` requires
an Argon2id PHC file, an exact HTTPS public origin and one trusted TLS proxy IP.
No default password, user database, registration or email recovery exists.

| Route | Contract |
| --- | --- |
| `GET /healthz` | Public `200 ok`; liveness only, no browser launch |
| `GET /api/auth/status` | `{required, authenticated}`; no-store |
| `POST /api/auth/login` | JSON `{password}`; 4 KiB body; correct credentials set a cookie |
| `POST /api/auth/logout` | Same-origin POST; revoke current session and expire cookie; idempotent 204 |
| Existing `/api/*` operations | Require the cookie in hosted mode, including preview and ZIP reads |

Cookie: `__Host-fount_session`, 256 random bits, HttpOnly, Secure, SameSite=Strict,
Path=/, Max-Age=43200. Only SHA-256 digests of tokens remain in server memory.
Session expiration is absolute, not sliding. Restart/password replacement revokes
all sessions; expiry/logout returns 401 from operations. Auth responses never cache.
POST requests require an Origin exactly equal to `--public-origin`. Only the
configured proxy may assert HTTPS and `X-Fount-Client-IP`; the Compose subnet and
`--trusted-proxy` must be changed together if they conflict with an existing network.

Errors retain the existing `{error: string}` contract. 401 means sign in, 403 means
an invalid origin/proxy context, 429 means attempts exhausted (Retry-After 900) or
another job running (Retry-After 5). Login accepts at most five reserved attempts
per address in a 15-minute window; successful verification resets that address.
One Argon2 verifier, 2048 rate-limit entries and 32 sessions bound memory.

The web gate unmounts the store on logout/401, aborts requests and clears collection,
upload draft and history. Hosted history uses sessionStorage. UI preferences may
remain in localStorage. Files and passwords are never placed there. Tab reload
can restore a draft only while the server upload still exists (30 minutes).

Hosted resource limits: one heavy job; upload 16 files, 20 MiB each, 64 MiB total;
90 MiB JSON body; 30-second upload deadline; 180-second response deadline;
75-second HTTP batch/scan deadline; 90-second Chromium lifetime. A timeout or
disconnect does not release the permit while synchronous work is still running.
The worker drains the bounded stream and frees its permit when work finishes.
Conversion checks declared expanded size (32 MiB/font) and bounds the aggregate
converted output (128 MiB). Container memory remains the hard limit for malformed
fonts and hostile pages; timeout is not a process sandbox for Rust conversion.

Uploads live for 30 minutes, archives 15 minutes, scans 30 minutes. Hosted uploads
and archives each have a 128 MiB retained-byte budget and a count limit of 32.
`/tmp` and browser profiles live in a 512 MiB tmpfs; restart removes them. Server
restarts invalidate upload IDs and prepared ZIP URLs; users upload/prepare again.

HTTP DNS resolution and redirects reject private targets. Chromium tab requests
are checked before navigation/fetch. Browser checks alone are not a network
sandbox: workers, DNS rebinding and Chromium vulnerabilities require host/container
egress controls. See the deployment checklist; do not describe this as a public
multi-tenant scraper or an audited sandbox.

## Future extension boundary

`extension/src/backend.js` selects the existing local engine by default. No new
permissions, server requests, cookies, credentials or uploaded page data are added.
The future adapter must provide the engine methods already used by the popup,
including scanActiveTab, preview loading, convertFonts and deliver, while owning
its cancellation/progress lifecycle. It can use the supplied hosted transport
factory after pairing is implemented; errors distinguish auth, busy and unavailable.

Do not assume cross-origin extension fetches can use this website cookie:
SameSite=Strict deliberately prevents that. A future integration must either open
a Fount-origin tab for the authenticated workflow or introduce explicit pairing
with a scoped, revocable token and user consent. No token is embedded in extension
source, and the website password must never be stored in chrome.storage. No
server mode toggle appears until an actual adapter and pairing flow exist.
