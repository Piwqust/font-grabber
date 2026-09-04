# Hosted Fount

Private instance of the web app behind Caddy HTTPS and HTTP Basic Auth.
The app container is not published to the Internet; only Caddy exposes ports
80 and 443. Hosted mode is ZIP-only — the local “Folder” option would write
files onto the server disk.

Discovery uses embedded Chromium in the app image (CDP). There is no separate
Selenium / WebDriver container.

## Requirements

- A Linux server with Docker Engine and the Compose plugin.
- A DNS name whose `A` record points to that server.
- TCP ports 80 and 443 allowed through the server firewall.

Do not open port 8787 in the firewall.

## First deployment

1. Copy the repository to the server and open a terminal in this `deploy/` directory.
2. Create the environment file:

   ```sh
   cp .env.example .env
   ```

3. Edit `.env` and set `FOUNT_DOMAIN` to the real DNS name.
4. Generate a password hash on the server:

   ```sh
   docker run --rm caddy:2-alpine caddy hash-password --plaintext 'choose-a-long-password'
   ```

   Copy the resulting line into `FOUNT_AUTH_HASH` in `.env`. Store the real
   password in a password manager; it is not recoverable from the hash.
5. Start the stack:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 app caddy
   ```

6. Open `https://<your-domain>/`. The browser must request the configured
   username and password. Without credentials, the response must be `401`.

Caddy obtains and renews the HTTPS certificate automatically after DNS points
to the server and ports 80/443 are reachable.

## Update

```sh
docker compose up -d --build
```

To stop without deleting certificates:

```sh
docker compose down
```

Do not delete the `caddy_data` volume unless the certificates should be reissued.

## Limits

The app can handle public pages whose font URLs are discoverable by static CSS
or headless Chromium. It cannot guarantee downloads from CAPTCHA-protected
pages, login-only pages, expiring URLs, DRM/protected assets, or sites that
block automated browsers.

Private and loopback addresses are rejected (SSRF protection). `/api/font`
only proxies URLs discovered by a previous scan.
