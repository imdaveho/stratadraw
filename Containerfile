FROM docker.io/library/elixir:1.19.5

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    inotify-tools \
    nodejs \
    npm \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=C.UTF-8 \
    ELIXIR_ERL_OPTIONS=+fnu \
    MIX_ENV=dev \
    PHX_SERVER=true

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

EXPOSE 4225

CMD ["mix", "phx.server"]
