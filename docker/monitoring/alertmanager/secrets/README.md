# Alertmanager local secrets (gitignored)

`docker-compose.yml`'s `monitoring` profile bind-mounts this directory
read-only into the `alertmanager` container at `/run/secrets/alertmanager`.
Everything in here except this file and `.gitignore` is ignored by Git —
drop real secret files here to actually use the email/Telegram receiver
examples in `../tests/alertmanager.example-full.yml`:

- `smtp_password` — the value referenced by `auth_password_file` in the
  email example.
- `telegram_bot_token` — the value referenced by `bot_token_file` in the
  Telegram example.

Copy the corresponding `email_configs`/`telegram_configs` block from
`../tests/alertmanager.example-full.yml` into `../alertmanager.yml`'s
`page`/`ticket` receivers after dropping the file(s) in here. Neither file
needs to exist for the `monitoring` profile to boot — Alertmanager only
reads a `_file` path when that receiver's config block is actually
present, and this directory is always mounted (empty is fine) regardless
of whether either receiver has one.
