# Updating

New versions are published as container images. Updating means pulling the new image and recreating the container; your data volume stays as it is.

## Update

=== "docker run"

    ```sh
    docker pull ghcr.io/rouzax/giftdraw:latest
    docker stop giftdraw
    docker rm giftdraw
    docker run -d --name giftdraw \
      --env-file .env \
      -v giftdraw-data:/data \
      -p 3000:3000 \
      --restart unless-stopped \
      ghcr.io/rouzax/giftdraw:latest
    ```

=== "Docker Compose"

    ```sh
    docker compose pull
    docker compose up -d
    ```

What happens:

- The volume, and with it every event, group and wish, is kept.
- On start, the app brings the database up to the new version by itself. If an update changed the database, an older image refuses to start with it (`Database schema version ... is newer than this code supports`). Back up the volume before updating if you may want to go back.
- Version 0.4.0 stores the wish form and the wishes in a new way without changing the database itself. An older image still starts on that volume, but shows the standard form and no wishes, and anything saved there overwrites what 0.4.0 stored. To go back from 0.4.0, restore the backup you made before updating instead.
- `docker stop` lets a mail that is being sent finish first, and mail still in the queue goes out after the restart.

Pick a quiet moment, such as an evening, so nobody is drawing at the very moment the app restarts.

## Versions and tags

| Tag | Points to |
| --- | --- |
| `latest` | The newest release. |
| `0.1.0` | That exact version; never changes. |
| `0.1` | The newest patch release of that minor version. |

Pin an exact version if you want to decide yourself when to update, and `latest` or the minor tag if you want updates to arrive with every pull.

Releases follow a fixed rhythm: dependency updates are merged automatically once the tests pass, and a new patch release is published on Mondays when anything in the image changed that week. Weeks without changes to the image get no release. Release notes are on the [GitHub releases page](https://github.com/Rouzax/giftdraw/releases).

## Check where the image comes from

Every image carries a signed build provenance attestation, which proves it was built by this repository's release workflow. Check it with the GitHub CLI:

```sh
gh attestation verify oci://ghcr.io/rouzax/giftdraw:latest --owner Rouzax
```

A passing check names the workflow that built the image. If it fails, do not run that image.
