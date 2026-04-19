# Stratadraw

An open canvas geared towards documenting and representing product, technical, and business capabilities/functionality and interactions as a context graph of atomic nodes and edges.
This follows the approach set forth by this collection of thoughts and considerations: [Atomic Patterns](https://atomicpatterns.imdaveho.com/5.+posts/Chapter+3%EA%9E%89+Atomic+Patterns/Atomic+Patterns)

## Stack

- Phoenix 1.8 + Bandit + Postgres
- React + TypeScript + Konva in `assets/`
- Phoenix Channels + Presence for realtime canvas sync
- Yjs + CodeMirror for collaborative markdown documents

## Local Development

1. Install Elixir 1.19.5, Erlang/OTP 28.1, Node.js, npm, and Postgres.
2. Run `mix setup`.
3. Start the app with `mix phx.server`.
4. Visit `http://localhost:4000`.

Useful commands:

- `mix format && mix compile && mix assets.build`
- `mix test`
- `mix ecto.reset`

Database env overrides used by dev and test configs:

- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`
- `PGDATABASE_TEST`

## Rootless Podman

First-time setup:

1. `PODMAN_COMPOSE_PROVIDER=podman-compose podman compose build`
2. `PODMAN_COMPOSE_PROVIDER=podman-compose podman compose run --rm app mix setup`

Run the app:

1. `PODMAN_COMPOSE_PROVIDER=podman-compose podman compose up`
2. Open `http://127.0.0.1:4225`

The app container bootstraps Hex and Rebar into container-managed volumes so `userns_mode: keep-id` works with `mix setup` and `mix phx.server`.

The repo-local container files are:

- `Containerfile`
- `compose.yaml`

The compose stack is designed for rootless Podman with `userns_mode: keep-id` and host ports bound to `127.0.0.1`.
The app container uses `docker.io/library/elixir:1.19.5`.
