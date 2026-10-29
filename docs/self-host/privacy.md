# Privacy and cleanup

Gift Draw keeps as little as it can, and erases it on its own a few weeks after each exchange.

## What is stored

- Names, optional email addresses and the chosen language of participants.
- Their wishes, and who gives to whom.
- With sign-up on, their yes or no and when it was given. People who do not take part are erased when you start the draw.
- When someone opened their link, drew, was invited, reminded or had a card printed.
- The mail queue: which mail went to whom and whether it failed, with a short error code. Mail text is not stored; it is built when the mail is sent.
- The event and group settings.

There are no accounts, no analytics and no outside resources on any page: no fonts, scripts or images from other sites. Every page asks search engines not to index it.

The logs never contain email addresses, links or wish text. Log lines about wishes and draws are written so that they cannot be combined to reveal who gives to whom.

## Automatic cleanup

Each event has a cleanup setting, **Clean up after (weeks)** (*Opruimen na (weken)*), from 1 to 52 and 4 by default. That many weeks after a group's exchange date, the group is deleted with all its participants, wishes, pairs and mail history. The event itself, its name and settings, stays until you delete it, so you can reuse it next year with new groups.

Cleanup runs every minute while the app is running, using the date in the app's time zone (`TZ`). After deleting, the app also clears the database's write-ahead log, so deleted participant data does not linger in that file.

## Deleting by hand

- **Delete group** on a group's dashboard removes the same data as the cleanup, at once.
- **Delete event** on the event page removes the event with all its groups.
- **Remove** on a participant's page takes one person out, erasing their wishes and stopping their link. See [Changes after opening](../guide/changes.md#someone-drops-out).

Each needs a confirmation and cannot be undone. Backups you made of the data volume are not touched; delete those yourself.

## Importing and templates

- An [imported file](../guide/import.md) is not kept: the app stores only the event, groups and participants it creates, as if they had been typed in.
- **Download as a template** (*Downloaden als sjabloon*) gives the event's settings and its groups' names, dates and places. It never holds participants, email addresses, links or pairs.
- A file made with an AI chat assistant has passed through the company behind that assistant, with whatever names and addresses you gave it. The import guide explains how to leave the addresses out.

## A link reached the wrong person

Make a new link on the participant's page. The old link and QR code stop working at once. See [Changes after opening](../guide/changes.md#a-link-reached-the-wrong-person).
