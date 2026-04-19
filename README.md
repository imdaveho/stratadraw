# Stratadraw

Phoenix + React + Konva scaffold for an anonymous multi-user schema editor.

Current MVP slice
- minimal landing page with schema code entry
- schema workspace route at `/schemas/:code`
- hand and cursor tools
- double-click empty space to create atoms
- drag atoms in cursor mode
- drag from an atom edge to create bonds
- free bonds with draggable endpoints and curvature handle
- right-click or toolbar placement for annotation threads
- stage pan and wheel zoom in hand mode, with temporary hand mode via `Space`

## Local development

Required toolchain
- Erlang/OTP `28.4.2`
- Elixir `1.19.5-otp-28`
- Node/npm
- PostgreSQL

This repo includes `.tool-versions` for `asdf`.

Setup
```bash
mix setup
mix ecto.create
mix ecto.migrate
mix phx.server
```

Open `http://localhost:4000`.

Environment variables used in development
- `PGHOST` default `localhost`
- `PGPORT` default `5432`
- `PGUSER` default `postgres`
- `PGPASSWORD` default `postgres`
- `PGDATABASE` default `stratadraw_dev`
- `PHX_BIND_ALL=true` to bind Phoenix to `0.0.0.0`
- `PORT` default `4000`

## Containers

Development container files
- `Containerfile.dev`
- `compose.yaml`

Start the app and Postgres with Docker or Podman Compose:
```bash
docker compose up --build
```

or

```bash
podman compose up --build
```

The compose app service waits for Postgres, installs deps, runs migrations, and starts Phoenix on `http://localhost:4225`.

Production build
- `Containerfile` builds a release image for `stratadraw`

## Verification

Available checks
```bash
mix assets.build
mix precommit
```

Note: `mix precommit` requires a reachable PostgreSQL server because the test alias creates and migrates the test database.
