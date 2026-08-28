# Secure Deployment Guide

This is the concrete, copy-pasteable companion to
[`SECURITY.md`](../SECURITY.md)'s threat model. Where that document states
*what* the security requirements are (and why), this one walks through
*how* to actually deploy Snapcast Manager safely in the scenarios where
that matters.

---

## 1. Who this is for / when you need this

Most users running Snapcast Manager on a home LAN behind their router's
NAT do **not** need a reverse proxy or TLS at all. The app is designed to
be reached over plain HTTP on your local network, and keeping it there is
perfectly sufficient security for the common case.

This guide is for you if you are:

- **Exposing the manager beyond a trusted home LAN** — e.g. reaching it
  from outside your home, or putting it on a network you don't fully
  trust.
- **Wanting HTTPS instead of plain HTTP** — e.g. for a nicer URL, or
  because a browser or network policy flags the plain-HTTP connection.
- **In a multi-tenant / shared-network scenario** where more than your
  own devices can reach the host.

If none of those apply, you can stop reading — see section 2 and enjoy
your LAN-only setup.

---

## 2. LAN-only is the safe default

Snapcast Manager has **no built-in TLS or reverse-proxy of its own**. It
is an Express server on Node.js (`server/src/index.ts`) that listens on
plain HTTP on port `3000` by default — the running process picks its port
from `process.env.PORT`, defaulting to `3000` — and it expects any TLS to
be terminated **by a reverse proxy in front of it**, not by itself. There
is no `https.createServer` or TLS-certificate option in the app.

- The default port is `3000`, and it is configurable at install time via
  `scripts/install.sh`'s `--port <N>` flag (or `--port=<N>`); the value is
  stored in `APP_PORT` and defaulted to `3000` when not supplied.
- The port can also be changed at runtime by setting the `PORT`
  environment variable in the service.

**The safe default is to keep it LAN-only:** do **not** create a
port-forward on your router, do **not** publish a public DNS record for
it, and do **not** expose port 3000 to the wider internet. On a trusted
home LAN behind your router's NAT, that's it — you're done.

### Firewall hardening (optional but recommended)

Even on a LAN you can harden things with a firewall that limits inbound
access to the app's port to your LAN's CIDR range. The most common tool on
this project's stated target (Debian / Raspberry Pi OS) is `ufw`. This
example allows SSH (so you don't lock yourself out) and the app's port
only from your local subnet:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp            # SSH, so you don't lock yourself out
sudo ufw allow from 192.168.1.0/24 to any port 3000
sudo ufw enable
```

Adjust the `192.168.1.0/24` to match your actual LAN subnet. If you
changed the app's port at install time, substitute that port for `3000`.

> **Note:** `scripts/install.sh` does **not** configure any firewall
> itself. It only opens the app's TCP port in the sense of starting the
> service that listens on it. The firewall guidance here is new hardening
> the installer does not automate — you opt in to it yourself.

---

## 3. Reverse proxy + TLS, if you need it

If you do want HTTPS, or you're exposing the manager beyond a trusted LAN,
put it behind a reverse proxy that terminates TLS. The manager keeps
serving plain HTTP on `localhost:3000`; the proxy talks HTTPS to the world
and forwards to the manager over the loopback interface.

### 3a. nginx

A complete, working nginx site config proxying `https://<your-host>` to
`http://localhost:3000`:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name snapcast.example.com;

    # Certificates issued by certbot (see below). Adjust paths if yours
    # live elsewhere.
    ssl_certificate     /etc/letsencrypt/live/snapcast.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/snapcast.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # The app's live-status stream is Server-Sent Events (SSE). nginx
        # buffers proxied responses by default, which would defeat it, so
        # turn buffering off and keep the connection alive. The app itself
        # already sends the SSE-friendly headers it needs
        # (Connection: keep-alive, Cache-Control: no-cache, and
        # X-Accel-Buffering: no), so these proxy settings must not strip or
        # override them.
        proxy_buffering off;
        proxy_set_header Connection '';

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect plain HTTP to HTTPS.
server {
    listen 80;
    listen [::]:80;
    server_name snapcast.example.com;
    return 301 https://$host$request_uri;
}
```

Replace `snapcast.example.com` with your real hostname. Enable it with:

```bash
sudo ln -s /etc/nginx/sites-available/snapcast-manager /etc/nginx/sites-enabled/
sudo nginx -t          # verify the config is valid before reloading
sudo systemctl reload nginx
```

**TLS via Let's Encrypt / certbot.** With nginx installed and the HTTP
redirect server block above in place, issue a real certificate:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d snapcast.example.com
```

certbot will place the certificates at the paths referenced above (or
configure nginx for you, depending on the flags you choose), set up
automatic renewal, and reload nginx. Renewal then happens automatically via
a systemd timer.

### 3b. Caddy (simpler alternative)

If you'd rather not hand-write nginx config, [Caddy](https://caddyserver.com/)
handles automatic HTTPS for you — it obtains and renews Let's Encrypt
certificates on its own, with no separate certbot step. A minimal config:

```caddyfile
snapcast.example.com {
    reverse_proxy localhost:3000
}
```

That's the whole site. Caddy gets the cert, serves HTTPS, and proxies to
the manager. (Caddy also handles SSE correctly out of the box.)

---

## 4. The myMPD warning, explicit and actionable

myMPD serves **its own web UI on port 8080** (configurable via
`/var/lib/mympd/config/http_port`) and that UI is **not** behind this
app's login. myMPD has its **own, separate authentication** (a PIN/ACL
feature, not this app's JWT login) — see the README's myMPD note: myMPD
ships its own UI on port 8080 and is **not** behind the manager's login,
so **enable myMPD's PIN/ACL on untrusted networks**.

This matters for a reverse-proxy setup in particular: **proxying the
manager's port does NOT automatically cover myMPD's port.** The nginx and
Caddy configs above only reach the manager on `localhost:3000`. Unless you
explicitly proxy or firewall myMPD's port too, myMPD on port 8080 remains
directly reachable by anyone who can reach the host — with only its own
PIN/ACL standing between them and your music library.

Two concrete ways to close that gap:

**Option A — also reverse-proxy myMPD's port.** In nginx, add a second
server block (or a location under the same one) that proxies
`http://localhost:8080` under its own path or subdomain. myMPD keeps its
own PIN/ACL as defense-in-depth on top of the proxy:

```nginx
server {
    listen 443 ssl;
    server_name mympd.example.com;

    ssl_certificate     /etc/letsencrypt/live/mympd.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mympd.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

(With Caddy: `mympd.example.com { reverse_proxy localhost:8080 }`.)

**Option B — simply firewall port 8080 to LAN-only.** Even if you expose
the manager itself more broadly, keep myMPD off the wider network. With
`ufw`:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8080
```

You can lead with whichever fits your setup — if you're already running a
proxy, Option A keeps everything on one TLS hostname; if you only need
myMPD on your own devices, Option B is the smallest change.

> On a trusted LAN with myMPD reachable only locally, this is the intended
> design. The concern is specifically exposing it beyond that — and the
> manager's login does not protect myMPD's port. See
> [`docs/troubleshooting.md`](troubleshooting.md) (myMPD section) for the
> same warning in a troubleshooting context.

---

## 5. Where to go next

- **[`SECURITY.md`](../SECURITY.md)** — the full privilege model (`snapmanager`
  user, sudo grants, systemd sandbox), threat model, known limitations, and
  the real-hardware validation checklist. Read this before exposing the app
  to anything beyond a trusted LAN.
- **[`docs/troubleshooting.md`](troubleshooting.md)** — if a deployment-
  specific issue comes up (including the myMPD and reverse-proxy caveats).
- **[`docs/installation.md`](installation.md)** — if you haven't installed
  yet, or need the install/update/uninstall walkthrough.
