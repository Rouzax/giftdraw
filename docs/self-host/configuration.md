# Configuration reference

All settings are environment variables, usually kept in the `.env` file you pass with `--env-file`. The app checks them at start; if one is wrong it does not start, and `docker logs` shows a line such as `Invalid configuration: APP_URL must be an absolute URL`. The message names the setting but never its value, since values may be secrets.

Values are trimmed of surrounding spaces, and an empty value counts as not set. The exceptions are `ADMIN_PASSWORD` and `SESSION_SECRET`, where spaces count; only a trailing carriage return (left by a `.env` file saved with Windows line endings) is dropped from those two.

## Required

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_URL` | required | The public address, for example `https://gifts.example.com`. Used in every link, mail and QR code. Form posts from any other origin are refused, so it must match the address in the browser exactly: scheme, host and port. Must start with `http://` or `https://`; a trailing `/` is dropped. |
| `ADMIN_AUTH` | required | How the organiser pages are protected: `password` or `proxy`. See [Organiser login](admin-login.md). |

## Password mode

| Variable | Default | What it does |
| --- | --- | --- |
| `ADMIN_PASSWORD` | none | The organiser password, at least 12 characters. Required when `ADMIN_AUTH=password`. Changing it logs out every organiser. |
| `SESSION_SECRET` | none | At least 32 characters; signs the login cookie. Required when `ADMIN_AUTH=password`. Generate one with `openssl rand -base64 48`. Changing it also logs everyone out. |

## Reverse proxy

| Variable | Default | What it does |
| --- | --- | --- |
| `TRUSTED_PROXIES` | none | Comma-separated IP addresses or CIDR ranges of your reverse proxy, as the container sees it, for example `192.0.2.10` or `192.0.2.0/24`. Required in proxy mode; recommended in password mode behind a proxy. Write IPv4 ranges as IPv4 (`192.0.2.0/24`, not `::ffff:192.0.2.0/120`). A `/0` range is refused, because it would trust everyone. |
| `ADMIN_USER_HEADER` | `Remote-User` | Proxy mode: the request header that carries the logged-in user name. Header names are not case-sensitive. |

## Email

Leave `SMTP_HOST` unset to run with email off. See [Email](email.md).

| Variable | Default | What it does |
| --- | --- | --- |
| `SMTP_HOST` | none | The mail server, for example `smtp.example.com`. Setting it turns email on. |
| `SMTP_PORT` | `587` | `587` (STARTTLS, required) or `465` (TLS from the start). Mail is never sent unencrypted. |
| `SMTP_USER` | none | SMTP login, if the server needs one. |
| `SMTP_PASS` | none | SMTP password. |
| `SMTP_FROM` | none | The sender people see, for example `Gift Draw <gifts@example.com>`. Required when `SMTP_HOST` is set. |

## Other

| Variable | Default | What it does |
| --- | --- | --- |
| `TZ` | `Europe/Amsterdam` | IANA time zone name for dates on screen, the 09:00 automatic opening, the reminder window and cleanup. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `PORT` | `3000` | The port the app listens on, 1 to 65535. The image sets it to `3000`. |
| `DB_PATH` | `./data/giftdraw.db` | The database file. The image sets it to `/data/giftdraw.db`; change it only when running outside the container. |

## Example

A complete `.env` for password mode behind a reverse proxy, with email on:

```sh
APP_URL=https://gifts.example.com
ADMIN_AUTH=password
ADMIN_PASSWORD=choose-a-long-password
SESSION_SECRET=paste-the-output-of-openssl-rand-base64-48
TRUSTED_PROXIES=192.0.2.10
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=gifts@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=Gift Draw <gifts@example.com>
TZ=Europe/Amsterdam
```

Replace every value with your own. The repository's `.env.example` has the same settings with an explanation above each.
