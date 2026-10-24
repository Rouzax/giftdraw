# Install with Docker

This page gets the app running in password mode, the simplest setup: the app shows its own login page and email is off. Add a mail server or a reverse proxy login afterwards if you want them.

## Before you start

- Docker is installed on the machine that will run the app.
- You know the address people will use, for example `https://gifts.example.com`, and your reverse proxy (or router) sends that address to port 3000 on this machine.
- `openssl` is available to generate a secret (any Linux or macOS machine has it).

## 1. Get the image

A ready-made image for amd64 and arm64 is published to the GitHub Container Registry:

```sh
docker pull ghcr.io/rouzax/giftdraw:latest
```

To build it yourself instead, from a checkout of the repository:

```sh
docker build -t ghcr.io/rouzax/giftdraw:latest .
```

The image is based on Node 22 on Alpine Linux, pinned by digest. It installs only production dependencies, with install scripts disabled, runs as the unprivileged `node` user, and uses `tini` so `docker stop` shuts the app down cleanly.

## 2. Write the settings file

Create a file called `.env` with at least this, or copy `.env.example` from the repository, which explains every setting:

```sh
APP_URL=https://gifts.example.com
ADMIN_AUTH=password
ADMIN_PASSWORD=
SESSION_SECRET=
```

Fill in both empty values:

- `ADMIN_PASSWORD`: a password of your own, at least 12 characters. This is what organisers type to log in.
- `SESSION_SECRET`: at least 32 random characters that sign the login cookie. Generate it with `openssl rand -base64 48` and paste the output.

`APP_URL` must be exactly the address in the browser's address bar, including `https://` and any port. It goes into every link, mail and QR code, and form posts from any other address are refused.

!!! warning "Keep `.env` private"

    It holds the organiser password and, once you add email, the SMTP login. Do not commit it to a repository or share it.

Every setting is listed in the [configuration reference](configuration.md).

## 3. Start the container

=== "docker run"

    ```sh
    docker volume create giftdraw-data
    docker run -d --name giftdraw \
      --env-file .env \
      -v giftdraw-data:/data \
      -p 3000:3000 \
      --restart unless-stopped \
      ghcr.io/rouzax/giftdraw:latest
    ```

=== "Docker Compose"

    ```yaml
    services:
      giftdraw:
        image: ghcr.io/rouzax/giftdraw:latest
        container_name: giftdraw
        env_file: .env
        volumes:
          - giftdraw-data:/data
        ports:
          - "3000:3000"
        restart: unless-stopped

    volumes:
      giftdraw-data:
    ```

    Start it with `docker compose up -d`.

## What happens

- On first start the database is created at `/data/giftdraw.db` inside the volume.
- The app listens on port 3000 and logs one `server_listening` line. See the logs with `docker logs giftdraw`.
- Within about half a minute `docker ps` shows the container as `healthy`. The image's health check calls `GET /health`, which answers `{"ok":true}` when the database responds.
- Organisers go to `APP_URL/admin`, for example `https://gifts.example.com/admin`, and log in with `ADMIN_PASSWORD`. Then follow [Run a gift draw](../guide/index.md).

If the container stops right away, `docker logs giftdraw` names the setting that is wrong, for example:

```text
Invalid configuration: SESSION_SECRET must be at least 32 characters
```

The app refuses to start while `ADMIN_PASSWORD` or `SESSION_SECRET` is empty or too short, so a forgotten value never leaves a known password in place.

## Your data

Everything lives in the volume. **Keep it**: removing the volume deletes every event, group and wish. To keep a copy, back up the volume.

If you mount a host directory on `/data` instead of a named volume, it must be writable by uid 1000, the `node` user in the image:

```sh
sudo chown 1000:1000 /srv/giftdraw-data
```

## Stopping

`docker stop giftdraw` lets a mail that is being sent finish first. If the mail server does not answer, the app stops anyway after about 8 seconds, or at once on a second stop signal. A mail cut off that way is sent again after the next start.

## Next steps

- Behind a reverse proxy, set `TRUSTED_PROXIES`, or let the proxy handle the login: see [Organiser login](admin-login.md).
- To send mail, add the `SMTP_` settings: see [Email](email.md).
