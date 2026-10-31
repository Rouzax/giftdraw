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

It only opens once the invitations were sent. The dashboard then shows **Drawing only opens once the invitations have been sent.** Send them; drawing opens within a minute because the date has passed. Also check that the app was running: the opening happens at 09:00 or, if the app was down then, as soon as it is back. While the event's sign-up is on, no group opens by itself; it can once you have [started the draw](guide/signup.md#start-the-draw).

### A card says "Print again"

Something on the card changed since it was printed: their person's wishes or name, who their person is, the group's date, time or place, or the event's theme or form. Open the card and print it again. See [When a printed card goes out of date](guide/in-person.md#when-a-printed-card-goes-out-of-date).

### Importing an event says "This is not a valid event file"

The message, *Dit is geen geldig evenementbestand*, names a line and character. Usually the assistant's answer was cut off, or only part of it was copied: the text must run from the first `{` to the last `}`. Ask the assistant for the whole file again, with only the JSON. A message about a missing `"version"` or an unknown field means the assistant did not follow the format; paste the list of problems into the chat and ask it to fix the file. See [Import an event from a file](guide/import.md).

### An imported file says "wishOptions" or "sections" is not a known field

(*"wishOptions" is geen bekend veld. Kijk de spelling na.*) The file says `"version": 2` but sets the wish form the version 1 way, with `wishOptions`, `petOptions` or `sections`. This happens when an assistant mixes an old request with a new one, or when someone changes only the version number of an old file. Either put `"version": 1` back, or ask the assistant to write the form as `questions`, using the request from [Import an event from a file](guide/import.md#1-have-the-file-written). The two versions are compared under [Version 1 files](guide/import.md#version-1-files).

### Participants no longer see a question or a choice

On the event page under **The form** (*Het formulier*), a hidden question is marked **Hidden** (*Verborgen*): press **Edit** (*Aanpassen*) and turn **Show** (*Tonen*) back on. Its answers come back with it. A question or choice that was removed is gone with its answers and has to be added again. Added again, even a standard question or choice becomes one of your own: it is shown exactly as typed to everyone and no longer follows each participant's language. See [Hide or remove a question](guide/event.md#hide-or-remove-a-question).

### An imported group has no pairs

A group gets its pairs once it has at least 3 participants. The check page warns about smaller groups. Add people on the group page and the pairs are made at once. If the event's sign-up is on, see the next item.

## Sign-up

### Everyone shows "Not paired yet", also in groups of 3 or more

(*Nog niet ingedeeld*) The event's sign-up is on. Nobody is paired until you start the draw, because only the people who said yes take part. When sign-up has closed, press **Make the pairs** (*Lootjes maken*) in the Sign-up panel on the event page. See [Start the draw](guide/signup.md#start-the-draw).

### The Invitations and Drawing panels are missing from the group dashboard

The dashboard says **Sign-up is on. Inviting and drawing come after it.** (*Aanmelden staat aan. Uitnodigen en trekken komen daarna.*) Sending invitations and opening drawing wait until you start the draw, which sends the invitations for every group itself. Before sign-up was sent you can still press **Turn off sign-up** instead, and everyone takes part.

### The "Make the pairs" button is missing

It appears once sign-up has closed: at the end of the closing date, or when you press **Close sign-up now** (*Aanmelden nu sluiten*). While sign-up is open, people can still change their answer.

### The Sign-up panel is missing from the event page

Someone in the event has already been invited: a group has had its invitations sent, has been marked **The links have been shared**, or has opened drawing, or someone got an invitation from their own page with **Resend invitation**. Sign-up only works before that, because the invitation already leads to the draw. A press from a page opened earlier shows **Sign-up can no longer be turned on: invitations have already been sent.** (*Aanmelden kan niet meer aan: er zijn al uitnodigingen verstuurd.*) Ask around yourself instead and remove the people who do not join, as in [Someone drops out](guide/changes.md#someone-drops-out).

### "Send now" is missing and the panel says the closing date has passed

(*De sluitdatum is voorbij.*) The closing date went by before the question was sent. Fill in **New closing date**, press **Move the date**, and **Send now** is back. See [Send the question](guide/signup.md#send-the-question).

### "Choose a date before the first exchange date."

(*Kies een datum voor de eerste ruildatum.*) The closing date must be before the earliest exchange date of all groups in the event, so that the answers are in before the first exchange. Choose an earlier closing date, or move that group's exchange date.

### "Choose a date before the day drawing opens automatically."

(*Kies een datum voor de dag waarop het trekken automatisch opengaat.*) A group has an automatic opening date on or before the closing date you chose. Choose an earlier closing date, or on that group's dashboard move its **Drawing opens automatically on** date to after the closing date, or clear it.

### A group is refused with "The exchange date must be after the sign-up closing date."

(*De ruildatum moet na de sluitdatum van het aanmelden liggen.*) While sign-up runs, every group's exchange date must be after the closing date. Pick a later exchange date, or move the closing date first.

### A group is refused with "Drawing can only open automatically after the sign-up closing date."

(*Het trekken kan pas automatisch opengaan na de sluitdatum van het aanmelden.*) While sign-up runs, a group's automatic opening date must be after the closing date. Pick a later date, leave the field empty, or move the closing date first.

### Someone wants to join after sign-up closed

Their page says **Sign-up is closed.** and asks them to contact you.

- **Before you start the draw**: press **Set to yes** next to their name in the Sign-up panel, or open sign-up again with a new closing date so everyone can still answer.
- **After you start the draw**: if they had not said yes, they were removed. Add them to their group again as in [Someone joins late](guide/changes.md#someone-joins-late). They get a new link and, with email on, their invitation straight away.

### "You cannot make the pairs yet" and there is no confirm button

(*Je kunt de lootjes nog niet maken.*) A group has only one or two people taking part, and drawing needs at least 3. The page names each such group. Set more people in it to yes, add someone to it (after closing a newcomer counts as yes), or remove the group on its dashboard if it is not taking part this time. Then press **Make the pairs** again. Nobody was removed and nothing was sent. See [When a group has only one or two people taking part](guide/signup.md#when-a-group-has-only-one-or-two-people-taking-part).

### "...'s answer has changed in the meantime" after Set to yes or Set to no

(*Het antwoord van ... is intussen veranderd.*) The person answered, or the answer was set on another page, after you opened yours. Nothing was saved, so their newer answer stands. The page shows the answer as it is now; press again if you still want to change it.

### A group has no pairs after starting the draw

Nobody in it took part, so it was left empty. Add people to the group: from 3 people on it is paired at once, and with email on the newcomers get their invitation straight away.

## Mail

### Mails stay "Queued"

Check that the container is running; the queue is worked through every minute. Then look for `mail_failed` lines in `docker logs giftdraw`: the `code` field names the problem, for example a connection or login error. Fix the SMTP settings and restart the container; queued mails then go out.

### The dashboard shows a mail failure

The mail server refused the message or could not be reached, and the automatic retries ran out. The Mail failure column says what went wrong in words, with the technical code in small print beside it, such as `EENVELOPE-550`.

- **One person fails, the server refused the address**: check the address on the participant's page, correct it, then press **Send again** (*Opnieuw sturen*).
- **Every mail fails, or the reason is a refused sender**: check `SMTP_HOST`, `SMTP_PORT`, the login, and that the server accepts `SMTP_FROM` as sender. After fixing and restarting, press **Send all failed mail again** on each group.

An invitation that reached the person earlier stays marked as sent; only the failed resend shows in the failure column. [When a mail fails](guide/follow-up.md#when-a-mail-fails) lists every reason.

### Someone did not get a reminder

Reminders go only to people with an email address who received an invitation, at most two of each kind, between 09:00 and 20:00, and never on or after the exchange date. The first wishes reminder comes no sooner than 3 days after the invitation (5 days when the group has no automatic opening date), the first draw reminder 3 days after opening. With email off, or with every question of the wish form hidden, no wish reminders are sent at all. You can always send one by hand with **Send a reminder now** on their page, except while the event's sign-up runs: then no wish or draw reminders go out at all.

### Someone did not get a sign-up reminder

Sign-up reminders go only to people with an email address who were sent the sign-up mail and have not answered, a week and two days before the closing date, between 09:00 and 20:00. Someone whose answer you set before pressing **Send now** was never sent it, so gets none. Nobody gets one on the day they were sent the sign-up mail, so with a closing date a week or less after sending there is only the second, and with two days or less, none. Each person gets at most two, also after moving the date or opening sign-up again. With email off none are sent. The "Are you sure?" mail goes once, two days before the closing date, only to people who were sent the sign-up mail on an earlier day and whose answer was no before 09:00 that day. While sign-up is open you can send the question again by hand with **Send the sign-up mail again** on their page. See [What the app sends by itself](guide/signup.md#what-the-app-sends-by-itself).

### A giver did not get a "wishes updated" mail

That mail goes only to a giver who has already drawn and has email, about 15 minutes after the first change, and not from the exchange date on. A giver who has not drawn yet sees the new wishes when they draw.

## Participants

### A participant sees "This page does not exist. Please check the link."

(*Deze pagina bestaat niet. Kijk of de link klopt.*) The link is cut off, mistyped, or you made a new link for them since. Copy the current link from their page, or resend the invitation. A participant removed from the group gets the same page, including people removed because they did not take part after sign-up.

### A participant sees "Too much at once. Please try again in a minute."

(*Even te veel tegelijk. Probeer het over een minuut opnieuw.*) Their internet address tried too many links that do not exist, or loaded a very large number of pages. Waiting a minute helps. If a whole group shares one connection behind your reverse proxy and this happens often, set `TRUSTED_PROXIES` so the app can tell people apart.
