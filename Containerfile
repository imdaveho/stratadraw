FROM elixir:1.19.5-otp-28-slim AS build

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    ELIXIR_ERL_OPTIONS=+fnu \
    MIX_ENV=prod

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential \
      git \
      nodejs \
      npm && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs mix.lock ./
COPY config ./config

RUN mix deps.get --only prod
RUN mix deps.compile

COPY assets/package.json assets/package-lock.json ./assets/

RUN npm --prefix assets install

COPY assets ./assets
COPY lib ./lib
COPY priv ./priv

RUN mix assets.deploy
RUN mix compile
RUN mix release

FROM debian:trixie-slim AS runtime

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      libncurses6 \
      libstdc++6 \
      openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN useradd --create-home --shell /bin/bash appuser && chown appuser:appuser /app

COPY --from=build --chown=appuser:appuser /app/_build/prod/rel/stratadraw ./

USER appuser

EXPOSE 4225

CMD ["/app/bin/stratadraw", "start"]
