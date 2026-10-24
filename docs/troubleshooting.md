# Troubleshooting

Find what you see, then the likely cause and the fix. Messages are given in English with the Dutch wording in brackets.

## Starting the app

### The container stops right after starting

Run `docker logs giftdraw`. A wrong or missing setting is named in a line such as:

```text
Invalid configuration: SESSION_SECRET must be at least 32 characters
```

Fix that setting in `.env` and start the container again. The [configuration reference](self-host/configuration.md) lists every setting and its rules. Common ones: `APP_URL` without `https://`, `ADMIN_PASSWORD` shorter than 12 characters, `SMTP_HOST` set without `SMTP_FROM`, or `TRUSTED_PROXIES` missing in proxy mode.

### The container stops and the log mentions the database

If you mounted a host directory on `/data` instead of a named volume, it must be writable by uid 1000, the user the app runs as: `sudo chown 1000:1000 <directory>`. A log line saying the database schema version is newer than the code supports means the data was used by a newer version of the app; see [Updating](self-host/updating.md).

### Dates, the opening time or the reminders are an hour or more off

The app uses `TZ` (default `Europe/Amsterdam`) for every date and for the 09:00 opening and reminders. Set `TZ` to your own IANA time zone name and recreate the container.

## Logging in

### Proxy mode: every /admin page shows "No access" (403)

The page says **No access** (*Geen toegang*). The connection did not come from an address in `TRUSTED_PROXIES`, or the user header was missing. The log shows `admin_proxy_rejected` with a `reason`:

- `untrusted_source` (at info level): set `TRUSTED_PROXIES` to the address the container sees, which is the proxy's address on the Docker network or the network's gateway, not its public IP. See [Which address goes in TRUSTED_PROXIES](self-host/admin-login.md#which-address-goes-in-trusted_proxies).
- `missing_user` (at warn level): check that forward auth covers `/admin` and that the header name matches `ADMIN_USER_HEADER`.

### "Too many attempts. Please try again later." and nobody can log in

(*Te veel pogingen. Probeer het later opnieuw.*) In password mode, more than 50 wrong passwords were tried in the last hour, possibly by someone guessing, or 10 from your own address in 15 minutes. Wait up to an hour; organisers who are still logged in keep working. If it happens behind a reverse proxy, set `TRUSTED_PROXIES` so the app can tell visitors apart instead of counting everyone as one.

### The login page appears with "You are no longer logged in, so this was not carried out."

(*Je bent niet meer ingelogd, dus dit is niet uitgevoerd.*) Your login ran out while a page was open, or `ADMIN_PASSWORD` or `SESSION_SECRET` changed. Nothing was saved. Log in and do it again.

## Using the organiser pages

### A button gives "Sorry, this is not allowed." (403)

(*Dit mag helaas niet.*) The address in the browser differs from `APP_URL`: `http` versus `https`, another host name, or another port. Open the app through exactly the address in `APP_URL`. If people reach the app through two names, pick one for `APP_URL` and redirect the other to it in your proxy.

### The "Open drawing" button is refused

Send the invitations first (with email off: press **The links have been shared**), and make sure the group has at least 3 people. The message in the Drawing panel says which of the two it is.

### Drawing did not open on its automatic date

It only opens once the invitations were sent. The dashboard then shows **Drawing only opens once the invitations have been sent.** Send them; drawing opens within a minute because the date has passed. Also check that the app was running: the opening happens at 09:00 or, if the app was down then, as soon as it is back.

### A card says "Print again"

Something on the card changed since it was printed: their person's wishes or name, who their person is, the group's date, time or place, or the event's theme or form. Open the card and print it again. See [When a printed card goes out of date](guide/in-person.md#when-a-printed-card-goes-out-of-date).

### Importing an event says "This is not a valid event file"

The message, *Dit is geen geldig evenementbestand*, names a line and character. Usually the assistant's answer was cut off, or only part of it was copied: the text must run from the first `{` to the last `}`. Ask the assistant for the whole file again, with only the JSON. A message about a missing `"version"` or an unknown field means the assistant did not follow the format; paste the list of problems into the chat and ask it to fix the file. See [Import an event from a file](guide/import.md).

### An imported group has no pairs

A group gets its pairs once it has at least 3 participants. The check page warns about smaller groups. Add people on the group page and the pairs are made at once.

## Mail

### Mails stay "Queued"

Check that the container is running; the queue is worked through every minute. Then look for `mail_failed` lines in `docker logs giftdraw`: the `code` field names the problem, for example a connection or login error. Fix the SMTP settings and restart the container; queued mails then go out.

### The dashboard shows a mail failure

The mail server refused the message or could not be reached, and the automatic retries ran out. The Mail failure column says what went wrong in words, with the technical code in small print beside it, such as `EENVELOPE-550`.

- **One person fails, the server refused the address**: check the address on the participant's page, correct it, then press **Send again** (*Opnieuw sturen*).
- **Every mail fails, or the reason is a refused sender**: check `SMTP_HOST`, `SMTP_PORT`, the login, and that the server accepts `SMTP_FROM` as sender. After fixing and restarting, press **Send all failed mail again** on each group.

An invitation that reached the person earlier stays marked as sent; only the failed resend shows in the failure column. [When a mail fails](guide/follow-up.md#when-a-mail-fails) lists every reason.

### Someone did not get a reminder

Reminders go only to people with an email address who received an invitation, at most two of each kind, between 09:00 and 20:00, and never on or after the exchange date. The first wishes reminder comes no sooner than 3 days after the invitation (5 days when the group has no automatic opening date), the first draw reminder 3 days after opening. With email off, or with every part of the wish form hidden, no wish reminders are sent at all. You can always send one by hand with **Send a reminder now** on their page.

### A giver did not get a "wishes updated" mail

That mail goes only to a giver who has already drawn and has email, about 15 minutes after the first change, and not from the exchange date on. A giver who has not drawn yet sees the new wishes when they draw.

## Participants

### A participant sees "This page does not exist. Please check the link."

(*Deze pagina bestaat niet. Kijk of de link klopt.*) The link is cut off, mistyped, or you made a new link for them since. Copy the current link from their page, or resend the invitation. A participant removed from the group gets the same page.

### A participant sees "Too much at once. Please try again in a minute."

(*Even te veel tegelijk. Probeer het over een minuut opnieuw.*) Their internet address tried too many links that do not exist, or loaded a very large number of pages. Waiting a minute helps. If a whole group shares one connection behind your reverse proxy and this happens often, set `TRUSTED_PROXIES` so the app can tell people apart.
