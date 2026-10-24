# Email

Email is optional. With a mail server the app sends the invitations, the "you can draw now" mail, reminders and change notices by itself. Without one, everything else works the same and you hand out the links yourself.

## Email off

Leave `SMTP_HOST` unset and the app runs with **email off**:

- Nothing is ever mailed, and no address is marked as invited.
- The group dashboard says **Email is off: share the links yourself.** and leaves out the Invited, Last reminder and Mail failure columns.
- The invitation button reads **The links have been shared** (*De links zijn gedeeld*). Pressing it sends nothing; it records that you shared the links, which drawing needs before it can open.
- You share each link yourself: copy it, show or print the participant's QR code, or print their card after the draw. See [Send the invitations](../guide/invitations.md#with-email-off).
- Where a change would have mailed someone, such as a giver whose person changed, the preview tells you to let them know yourself.

You can still store email addresses. If you turn email on later, the Invitations panel offers to send the invitations those people have not had yet; reminders only go to people who got an invitation mail.

## Turn email on

Add these to `.env` and recreate the container:

```sh
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=gifts@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=Gift Draw <gifts@example.com>
```

- `SMTP_PORT` is `587` (STARTTLS) or `465` (TLS from the start). On 587 the app refuses to send if the server does not offer encryption, so mail never goes out unencrypted.
- Leave `SMTP_USER` and `SMTP_PASS` out if the server needs no login.
- `SMTP_FROM` is required. Use an address the SMTP account is allowed to send from, or the server refuses the mail.

Sending through a regular mailbox provider often needs an app password rather than your normal password; check your provider's instructions for SMTP access.

## What the app sends

| Mail | Sent when |
| --- | --- |
| Invitation | You press **Send invitations**, and when you add someone with email to a group whose invitations already went out. |
| You can draw a name now | The group opens, by the button or on its automatic date. A newcomer in an open group gets one invitation that says they can draw straight away instead. |
| Wishes reminder | At most two, before drawing opens, to people who filled in nothing. |
| Draw reminder | At most two, after drawing opens, to people who have not drawn. |
| Wishes updated | Someone changes their wishes after their giver has drawn; about 15 minutes after the first change, bundled. |
| Your person has changed | A giver who had drawn gets a new person because someone joined or dropped out. |

Reminders only go out between 09:00 and 20:00 in the app's time zone (`TZ`) and never on or after the exchange date. The full timing is in [Follow up](../guide/follow-up.md#reminders); what each mail looks like is in [What participants see](../participants.md#the-mails).

## The queue

Mail goes out through a queue in the database, which the app works through every minute, and right away after you press a button that sends mail. A failed send is retried after 1, 5, 30 and 120 minutes, and then marked as failed on the dashboard with a **Send again** button. Mail waiting in the queue survives a restart.

Log lines for mail never contain addresses or message text. A failure is logged as `mail_failed` with a `code` field, such as `ECONNECTION` or `EAUTH`, that names the problem. See [Troubleshooting](../troubleshooting.md#mails-stay-queued) when mail does not arrive.
