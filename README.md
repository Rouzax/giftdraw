# Lootjes trekken / Gift Draw

A small, self-hosted web app for drawing names for a gift exchange within
a group. Everyone gets a personal link, draws the name of the person they
give a present to, and sees what that person likes. Nobody needs an
account or an app, and the screens for participants use large text and
one button at a time, so it works for people who rarely use a computer.

It was built for a teacher with several groups of older students, but it
suits any club, family or team.

**Example:** this year the group does a *regift*. Each person gives
something they already own and would like to pass on, so nothing new has
to be bought; anyone who does buy something spends at most 5 euro. The
organiser sets this theme once, and every participant reads it at the top
of their page and on their printed card.

The interface is in Dutch (default) and English. Each participant can
switch language on their own page, and the organiser can switch in the
admin header. Switching while filling in the wish form saves what was
typed so far, so nothing has to be typed again.

## How it works

### For the organiser

1. **Create an event**, for example "Gifts 2026". Set the default
   language, how many weeks after the exchange the data is deleted, the
   theme text, and the choices people can tick under "I like...". Empty
   fields use the built-in regift text and choice list. A choice can ask a
   short question with a text field: write it after a question mark, as in
   `Books? Which author?`. A question mark alone (`Books?`) asks "Anything
   in particular?", except on the built-in chocolate choice, which keeps
   asking "Which flavour?". Under "The form" you choose which parts of the
   wish form participants see (Hobbies, I like, Pets, Rather not, Anything
   else, always in that order) and can give each part your own heading.
   An empty heading shows the usual one in each participant's language; a
   typed heading (one line, at most 80 characters) is shown as typed to
   everyone. A hidden part disappears from the form, the result page, the
   wishes mail and the printed card, but answers already given are kept and
   come back when you show the part again. Answers that sit only in hidden
   parts count as not filled in on the dashboard, and with every part
   hidden no wish reminders are sent. The pet choices work like the "I
   like..." choices; empty gives Dog, Cat and Other (which asks "Which
   animal?"). In both lists, removing or renaming a choice drops what
   participants had ticked for it. Changing the parts, the headings or
   either list of choices marks printed cards as out of date; saving the
   page without a change, also after switching the event language, does
   not. Renaming a participant marks the card of the person giving to
   them as out of date.
2. **Create a group** per class or team, with the date the presents are
   exchanged and, if you like, a date on which drawing opens by itself
   (at 09:00). You can also give the time and the place of the exchange,
   such as `10:30` and "Yoga studio De Lotus, Main Street 1". Both are
   optional; when set they appear next to the date in every mail, on
   every participant screen and on the printed card, for example "We give
   the presents on Friday 18 December at 10:30, at Yoga studio De Lotus,
   Main Street 1." The place is one line of at most 200 characters. The form
   for a new group starts filled in with the settings of the group you
   created last, so groups that meet in the same place need no retyping.
3. **Paste the participants**, one per line: `Name, email@example.com`.
   Someone without email is just `Name`. The app pairs everyone straight
   away in one big circle, so nobody gets themselves and no two people
   simply swap presents. Names may contain emoji. Before anything is
   added you see the lines that will be skipped, such as an address with
   an emoji or an accented letter in it, which mail servers and the
   email field on the participant's page do not accept.
4. **Send the invitations.** Everyone with an email address gets a
   welcome mail with their link and is asked to say a little about
   themselves. With email off the button reads "The links have been
   shared" instead: share each link yourself (copy it, or show or print
   the QR code on the participant's page), then press it.
5. **Optionally rearrange pairs** on the "View and swap pairs" page by
   dragging one person onto another or tapping two people. The app refuses
   any swap that would make someone give to themselves. Swaps can create
   two people who give to each other; the app allows that.
6. **Open the drawing** with the button, or let the auto-open date do it.
   A group only opens after its invitations were sent. Everyone with email
   gets a "You can draw a name now" mail. Opening cannot be undone.
7. **Follow the dashboard**: who opened their link, filled in their
   wishes, and drew. Reminders go out by themselves (see
   [Email](#email)).
8. **Help someone in person.** On a participant's page you can fill in
   their wishes, draw for them on your screen (ideally with them next to
   you), and print an A5 card with their person, the theme and that
   person's wishes. This is the way to include someone without email or
   a phone. The participant page does not name their person before they
   have drawn, so you can sit together; afterwards the name is behind
   "Show who ... drew".

Someone can still drop out or join after drawing has opened. The
participant page shows exactly which pair changes before you confirm.
Only one person gets a new receiver, and their mail says only that their
person has changed and who the new one is, never who dropped out. With
email off, or when that giver has no email, the preview names them so
you can tell them yourself or print their card again.

### For a participant

1. Open the personal link from the mail, a message or a QR code.
2. Before drawing opens: say a little about yourself (hobbies, things you
   like, pets, things to avoid). Everything is optional.
3. Once drawing is open: press "Draw a name". A paper slip comes out of a
   bowl with the name on it.
4. The page then shows who you give a present to, the theme, the exchange
   date (with the time and place, if the organiser set them) and what your
   person likes. Opening the link again later shows the
   same result, so it works as a reminder.

## Running with Docker

### What you need

- Docker on the machine that will run the app.
- A web address people can reach, ideally HTTPS through a reverse proxy.
- For email (optional): an SMTP account that may send from your sender
  address.

### Get the image

A ready-made image for amd64 and arm64 is published to the GitHub
Container Registry:

```sh
docker pull ghcr.io/rouzax/giftdraw:latest
```

Tags: `latest`, the exact version (for example `0.1.0`) and the minor
line (`0.1`). Dependency updates are merged automatically once the tests
pass, and a new patch release is published on Mondays when anything in
the image changed that week. To update, pull the image again and recreate
the container; the data volume is kept.
Every image carries a signed build provenance attestation; check it with
`gh attestation verify oci://ghcr.io/rouzax/giftdraw:latest --owner Rouzax`.

To build it yourself instead, from a checkout of this repository:

```sh
docker build -t ghcr.io/rouzax/giftdraw:latest .
```

The image is based on `node:22.23.4-alpine` (Alpine 3.24) pinned by digest, installs only
production dependencies with install scripts disabled, runs as the
unprivileged `node` user, and uses `tini` so `docker stop` shuts the app
down cleanly.

### Configure

Copy `.env.example` to `.env` and fill it in. The minimum for password
mode without email:

```sh
APP_URL=https://gifts.example.com
ADMIN_AUTH=password
ADMIN_PASSWORD=
SESSION_SECRET=
```

Fill in both: `ADMIN_PASSWORD` is a password of your own of at least 12
characters, and `SESSION_SECRET` the output of `openssl rand -base64 48`.
While either is empty or too short the app refuses to start and names the
setting.

Keep `.env` private: it holds the admin password and the SMTP login.

### Run

```sh
docker volume create giftdraw-data
docker run -d --name giftdraw \
  --env-file .env \
  -v giftdraw-data:/data \
  -p 3000:3000 \
  --restart unless-stopped \
  ghcr.io/rouzax/giftdraw:latest
```

What happens:

- The database is created at `/data/giftdraw.db` inside the volume on
  first start. Keep the volume: removing it deletes every event, group
  and wish. Back up the volume to keep a copy. If you mount a host
  directory on `/data` instead of a named volume, it must be writable by
  uid 1000 (the `node` user): `sudo chown 1000:1000 <directory>`.
- The app listens on port 3000 and logs one `server_listening` line.
  Logs are JSON lines on standard output (`docker logs giftdraw`); they
  never contain email addresses, links or wish text.
- `GET /health` answers `{"ok":true}` when the database responds. The
  image's `HEALTHCHECK` uses it, so `docker ps` shows `healthy` within
  about half a minute.
- Organisers go to `APP_URL/admin`. Participant links look like
  `APP_URL/p/<long random code>`.

If the container exits right away, `docker logs giftdraw` names the
setting that is wrong, for example
`Invalid configuration: SESSION_SECRET must be at least 32 characters`.

`docker stop giftdraw` lets a mail that is being sent finish first. If the
mail server does not answer, the app stops anyway after about 8 seconds,
or at once on a second stop signal. A mail cut off that way is sent again
after the next start.

## Configuration

All settings are environment variables. Values are trimmed, except the
password and session secret, where spaces count; only a trailing carriage
return (left by an env file saved with Windows line endings) is dropped
from those two.

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_URL` | required | Public address, for example `https://gifts.example.com`. Used in every link, mail and QR code. Form posts from any other origin are refused, so it must match the address in the browser exactly (scheme, host and port). |
| `ADMIN_AUTH` | required | `password` or `proxy`. See [Admin access](#admin-access). |
| `ADMIN_PASSWORD` | none | Password mode: the organiser password, at least 12 characters. Changing it logs out every session. |
| `SESSION_SECRET` | none | Password mode: at least 32 characters, signs the login cookie. Changing it also logs everyone out. |
| `TRUSTED_PROXIES` | none | Comma-separated IP addresses or CIDRs of your reverse proxy, for example `192.0.2.10` or `192.0.2.0/24`. Write IPv4 ranges as IPv4 (`192.0.2.0/24`, not `::ffff:192.0.2.0/120`); a `/0` range is refused. Required in proxy mode. |
| `ADMIN_USER_HEADER` | `Remote-User` | Proxy mode: the header carrying the logged-in user name. |
| `SMTP_HOST` | none | Mail server. Leave unset to run with email off. |
| `SMTP_PORT` | `587` | `587` (STARTTLS, required) or `465` (TLS from the start). Mail is never sent unencrypted. |
| `SMTP_USER` | none | SMTP login, if the server needs one. |
| `SMTP_PASS` | none | SMTP password. |
| `SMTP_FROM` | none | Sender address, for example `Gift Draw <gifts@example.com>`. Required when `SMTP_HOST` is set. |
| `TZ` | `Europe/Amsterdam` | IANA time zone for dates, the 09:00 auto-open and reminders. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `PORT` | `3000` | Listening port. Set by the image. |
| `DB_PATH` | `./data/giftdraw.db` | Database file. The image sets `/data/giftdraw.db`. |

## Admin access

Participant pages need no login: the long random code in each link is the
key. The organiser pages under `/admin` are protected in one of two ways.

### Password mode (`ADMIN_AUTH=password`)

The app shows its own login page. A login lasts 30 days in that browser.
A form sent after the login ran out is not carried out; the app shows the
login page with a note saying so.

- Wrong passwords are limited to 10 per 15 minutes per client address,
  and to 50 per hour in total. When the total limit is reached, nobody can
  log in for up to an hour, even with the right password. Organisers who
  are already logged in keep working.
- Behind a reverse proxy, set `TRUSTED_PROXIES` to the proxy's address.
  Otherwise the app sees every visitor as the proxy, so all clients share
  one rate-limit bucket: one person's wrong passwords count against
  everyone, and the participant page limits apply to all visitors
  together.

### Proxy mode (`ADMIN_AUTH=proxy`)

Your reverse proxy does the login (forward auth with a single sign-on
service, for example) and passes the user name in a header. The app has no
login page of its own and accepts an `/admin` request only when both are
true:

- the connection comes from an address in `TRUSTED_PROXIES`, and
- the `ADMIN_USER_HEADER` header is present and not empty.

Set it up like this:

- `TRUSTED_PROXIES` is the proxy's address **as the container sees it**,
  not its public address. A proxy container on the same Docker network
  connects from its address on that network; a proxy on the Docker host
  usually connects from the network's gateway (often in `172.16.0.0/12`).
- Apply forward auth to everything **except** `/p/`, `/static/` and
  `/health`. Participants must reach their links without logging in.
- Make sure the proxy sets the user header itself and drops any copy sent
  by the browser.

## Email

Email is optional. Without `SMTP_HOST` the app runs with **email off**:
nothing is mailed, the dashboard says so and leaves out the mail
columns, and you share every link yourself (copy it, or show or print the
participant's QR code or card). Everything else works the same.

With email on, the app sends:

- the invitation with the personal link, when you press "Send
  invitations" (people added later get one when you press it again);
- "You can draw a name now" when the group opens. Someone invited into a
  group that is already open, such as a late joiner, gets one invitation
  that says they can draw straight away, and no separate mail;
- at most two reminders to fill in wishes and at most two to draw, at
  09:00, spaced a few days apart and never on or after the exchange date.
  They only go out between 09:00 and 20:00 (`TZ`): one that becomes due
  later in the day, for example because the app was down in the morning,
  waits until 09:00 the next day. A reminder you send by hand does not
  count toward the two, but the next automatic one keeps the same spacing
  after it;
- a short note to the giver when their person changes their wishes after
  the giver has drawn (bundled, so several quick edits give one mail);
- "Your person has changed" to the one giver affected by a dropout or late
  joiner.

The "wishes updated" note goes only to a giver who has already drawn, and
not from the exchange date on. It is sent about 15 minutes after the
first change, and further changes in that window go into the same mail.
All other mail goes out within a minute.

Mail goes out through a queue that the app works through every minute. A
failed send is retried after 1, 5, 30 and 120 minutes; after that it is
marked as failed. The dashboard's "Mail failure" column shows the latest
failure per person, with a "Send again" button; a button above the table
sends every failed mail of the group again at once. Only the latest mail of each kind per
person counts, so a failure that a later mail of the same kind replaced is
not shown or sent again. Neither is mail that was skipped because it could
not apply, such as one for a person without an email address. A failed
invitation or "You can draw a name now" sent again after that person has
drawn is skipped too, so it does not ask them to start over.

Use port `587` (STARTTLS) or `465` (TLS). On 587 the app refuses to send
if the server does not offer encryption.

## Privacy and cleanup

- The app stores names, optional email addresses, wishes and who gives to
  whom. There are no accounts, no analytics and no outside resources on
  any page, and pages ask search engines not to index them.
- Each event has a cleanup setting in weeks (default 4). That many weeks
  after a group's exchange date, the group is deleted with all its
  participants, wishes, pairs and mail history. The event itself (its name
  and settings) stays until you delete it.
- Deleting an event or a group on its page removes the same data at once.
- If a link reaches the wrong person, make a new link on the participant's
  page; the old link and QR code stop working.

### Groups of three

A group needs at least 3 people. With exactly 3, anyone who has drawn can
work out every pair, because there is only one way to arrange the circle.
The dashboard warns about this; it is allowed, but the surprise is
smaller.

## Troubleshooting

**Proxy mode: every `/admin` page shows "No access" (403).**
The connection did not come from `TRUSTED_PROXIES`, or the user header was
missing. The log shows `admin_proxy_rejected` with `reason`
`untrusted_source` (at info level) or `missing_user` (at warn level). For `untrusted_source`, set
`TRUSTED_PROXIES` to the address the container sees (the proxy's Docker
network address or the gateway, not its public IP). For `missing_user`,
check that forward auth covers `/admin` and that the header name matches
`ADMIN_USER_HEADER`.

**A form shows "Sorry, this is not allowed." (403) after pressing a button.**
The browser's address differs from `APP_URL` (for example `http` versus
`https`, or another host name or port). Open the app through exactly the
address in `APP_URL`.

**Mails stay "Queued".**
Check that the container is running; the queue is worked through every
minute. Then look for `mail_failed` lines in `docker logs`: the `code`
field names the problem, for example a connection or login error. Fix the
SMTP settings and restart the container; queued mails then go out.

**The dashboard shows a mail failure.**
The mail server refused the message or could not be reached, and the
automatic retries ran out. The column says what went wrong in words
(the server could not be reached, did not answer in time, refused the
login, refused the address, refused the sender, ...) with the technical
code in small print beside it, such as `EENVELOPE-550`. An invitation
that reached the person earlier stays marked as sent; only the failed
resend shows in the failure column. Check the address on the
participant's page, then press "Send again" in that column. If every
mail fails, or the reason is a refused sender, check `SMTP_HOST`,
`SMTP_PORT`, the login, and that the server accepts `SMTP_FROM` as
sender.

**Nobody can log in for a while (password mode).**
More than 50 wrong passwords were tried in the last hour, possibly by
someone guessing. Wait up to an hour; existing logins keep working. If it
happens behind a reverse proxy, set `TRUSTED_PROXIES` so the app can tell
visitors apart.

**The "Open drawing" button is refused.**
Send the invitations first (with email off: press "The links have been
shared"), and make sure the group has at least 3 people.

## License

Licensed under the MIT License; see [LICENSE](LICENSE).

The icons come from [Lucide](https://lucide.dev) (ISC, partly MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
