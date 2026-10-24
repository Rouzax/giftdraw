# Lootjes trekken / Gift Draw

A small, self-hosted web app for drawing names for a gift exchange within
a group. Everyone gets a personal link, draws the name of the person they
give a present to, and sees what that person likes. Nobody needs an
account or an app, and the screens for participants use large text and
one button at a time, so it works for people who rarely use a computer.

It was built for a teacher with several groups of older students, but it
suits any club, family or team.

**Documentation: <https://rouzax.github.io/giftdraw/>**

- [Run a gift draw](https://rouzax.github.io/giftdraw/guide/): the
  organiser guide, from setting up an event to helping someone without
  email in person.
- [What participants see](https://rouzax.github.io/giftdraw/participants/):
  the participant screens and mails.
- [Host it yourself](https://rouzax.github.io/giftdraw/self-host/):
  Docker install, every setting, organiser login, email, privacy and
  updating.
- [Troubleshooting](https://rouzax.github.io/giftdraw/troubleshooting/),
  by what you see.

## Highlights

- Pairs are fixed in one big circle when people are added: nobody gets
  themselves and no two people simply swap presents. Drawing reveals the
  name with a paper slip coming out of a bowl.
- The organiser can fill in wishes, draw together on their own screen and
  print an A5 card for someone without email or a phone.
- Email is optional: with an SMTP server the app sends invitations,
  reminders and change notices; without one you share the links yourself.
- Dutch (default) and English, chosen per participant.
- No accounts, no analytics, no outside resources; each group is erased a
  few weeks after its exchange.

## Quick start

```sh
docker volume create giftdraw-data
docker run -d --name giftdraw \
  -e APP_URL=https://gifts.example.com \
  -e ADMIN_AUTH=password \
  -e ADMIN_PASSWORD='a-password-of-12-or-more-characters' \
  -e SESSION_SECRET="$(openssl rand -base64 48)" \
  -v giftdraw-data:/data \
  -p 3000:3000 \
  --restart unless-stopped \
  ghcr.io/rouzax/giftdraw:latest
```

Then open `APP_URL/admin`. The image is published for amd64 and arm64;
for a settings file, a reverse proxy login or email, follow
[Install with Docker](https://rouzax.github.io/giftdraw/self-host/install/).
`.env.example` lists every setting with an explanation.

## Development

Node 22.13 or newer.

```sh
npm ci            # .npmrc disables install scripts
npm test
npm run lint
npm run dev       # needs the settings from .env.example in the environment
```

The documentation site is built with [Zensical](https://zensical.org)
from `docs/` and `zensical.toml`:

```sh
python3 -m venv .venv
.venv/bin/pip install --require-hashes -r docs/requirements.txt
.venv/bin/zensical serve
```

## License

Licensed under the MIT License; see [LICENSE](LICENSE).

The icons come from [Lucide](https://lucide.dev) (ISC, partly MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
