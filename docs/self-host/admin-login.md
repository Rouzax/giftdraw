# Organiser login

Participant pages need no login: the long random code in each link is the key. The organiser pages under `/admin` are protected in one of two ways, chosen with `ADMIN_AUTH`.

- **Password mode** is the simplest: one shared organiser password, and the app shows its own login page. Pick it unless you already run a single sign-on service.
- **Proxy mode** hands the login to your reverse proxy, for example forward auth with a single sign-on service. The app then has no login page of its own.

=== "Password mode"

    ```sh
    ADMIN_AUTH=password
    ADMIN_PASSWORD=choose-a-long-password
    SESSION_SECRET=paste-the-output-of-openssl-rand-base64-48
    # Behind a reverse proxy, also:
    TRUSTED_PROXIES=192.0.2.10
    ```

    Organisers go to `/admin`, get the login page and type the password. A login lasts 30 days in that browser. **Log out** (*Uitloggen*) is at the top right.

    - A form sent after the login ran out is not carried out. The app shows the login page with a note saying so; log in and do it again.
    - Wrong passwords are limited to 10 per 15 minutes per client address, and to 50 per hour in total. When the total limit is reached, **nobody can log in for up to an hour, even with the right password**. Organisers who are already logged in keep working.
    - Changing `ADMIN_PASSWORD` or `SESSION_SECRET` logs out everyone.

    **Behind a reverse proxy, set `TRUSTED_PROXIES`** to the proxy's address (see below). Without it the app sees every visitor as coming from the proxy, so all clients share one rate-limit bucket: one person's wrong passwords count against everyone, and the limits on participant pages apply to all visitors together.

=== "Proxy mode"

    ```sh
    ADMIN_AUTH=proxy
    TRUSTED_PROXIES=192.0.2.10
    # Only if your proxy uses another header than Remote-User:
    ADMIN_USER_HEADER=X-Forwarded-User
    ```

    Your reverse proxy does the login and passes the user name in a header. The app accepts an `/admin` request only when both are true:

    - the connection comes from an address in `TRUSTED_PROXIES`, and
    - the `ADMIN_USER_HEADER` header (default `Remote-User`) is present and not empty.

    Anything else gets a **No access** (*Geen toegang*) page with status 403.

    Set up the proxy like this:

    1. Apply forward auth to everything **except** `/p/`, `/static/` and `/health`. Participants must reach their links without logging in, and the health check must work without a login.
    2. Make sure the proxy sets the user header itself and **drops any copy sent by the browser**. Otherwise anyone could claim to be logged in.
    3. Set `TRUSTED_PROXIES` to the proxy's address as the container sees it (see below).

    There is no logout button in this mode; logging out is up to your single sign-on service.

## Which address goes in TRUSTED_PROXIES

`TRUSTED_PROXIES` is the address the proxy's connections **arrive from, as seen inside the container**, not the proxy's public address.

- A proxy container on the same Docker network connects from its address on that network.
- A proxy running on the Docker host itself usually connects from the network's gateway, often in `172.16.0.0/12`.

You can give several addresses or CIDR ranges, separated by commas, for example `172.18.0.0/16,192.0.2.10`. Write IPv4 ranges as plain IPv4. A `/0` range, which would trust every address, is refused at start.

In proxy mode a wrong value shows up in the log as `admin_proxy_rejected`; see [Troubleshooting](../troubleshooting.md#proxy-mode-every-admin-page-shows-no-access-403).

## Limits on participant pages

So nobody can guess links, an address that asks for 20 links that do not exist within a minute is blocked from all participant pages for a while, even for valid links. Separately, one address may load at most 600 participant pages per minute, which is enough for a whole class sharing one community-centre connection. Both limits need `TRUSTED_PROXIES` behind a reverse proxy to tell visitors apart.
