# Host it yourself

Gift Draw is a single Node.js app in a single container. It keeps everything in one SQLite database file and needs nothing else running beside it. A mail server is optional.

## What you need

- **A machine with Docker** that stays on while the draw runs. A small home server or VPS is plenty for a handful of groups.
- **A web address people can reach**, ideally HTTPS through a reverse proxy you already run (Caddy, Traefik, nginx and the like). Participants open their links from their own phones and computers, so the address has to work from outside your home network.
- **Optionally, an SMTP account** that may send mail from the sender address you want to use. Without it the app runs with email off and you share the links yourself.

## What runs

| Part | Details |
| --- | --- |
| Container image | `ghcr.io/rouzax/giftdraw`, for amd64 and arm64 |
| Port | 3000 inside the container |
| Data | One SQLite file, `/data/giftdraw.db`, on a volume you keep |
| Organiser pages | `https://your-address/admin`, protected by a password or by your reverse proxy's login |
| Participant pages | `https://your-address/p/<long random code>`, no login |
| Health check | `GET /health` answers `{"ok":true}` when the database responds |
| Logs | JSON lines on standard output, without email addresses, links or wish text |

## Pages in this section

1. [Install with Docker](install.md): pull the image, write the settings file, start the container.
2. [Configuration reference](configuration.md): every setting, its default and what it does.
3. [Organiser login](admin-login.md): password mode or proxy mode, and what `TRUSTED_PROXIES` is for.
4. [Email](email.md): connecting a mail server, and what "email off" means.
5. [Privacy and cleanup](privacy.md): what is stored and when it is erased.
6. [Updating](updating.md): new versions, release tags and checking the image's origin.
