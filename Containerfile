FROM docker.io/library/elixir:1.19.5

ARG WATCHMAN_VERSION=2026.04.13.00

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    binutils-dev \
    ca-certificates \
    cmake \
    curl \
    git \
    inotify-tools \
    libssl-dev \
    ninja-build \
    nodejs \
    npm \
    pkg-config \
    python3 \
    python3-dev \
    python3-pip \
    python3-setuptools \
    pex \
    rustc \
    cargo \
    sudo \
    libaio-dev \
    libboost-all-dev \
    libclang-dev \
    libdouble-conversion-dev \
    libdwarf-dev \
    libfast-float-dev \
    libgflags-dev \
    libgmock-dev \
    libgoogle-glog-dev \
    libgtest-dev \
    liblz4-dev \
    libsnappy-dev \
    libsodium-dev \
    libunwind-dev \
    libxxhash-dev \
    xxhash \
    zstd \
 && rm -rf /var/lib/apt/lists/*

RUN mix local.hex --force && mix local.rebar --force

RUN git clone --depth 1 --branch "v${WATCHMAN_VERSION}" \
      https://github.com/facebook/watchman.git /tmp/watchman \
 && cd /tmp/watchman \
 # && ./install-system-packages.sh \
 && PREFIX=/usr/local ./autogen.sh \
 && install -Dm755 built/bin/watchman /usr/local/bin/watchman \
 && install -Dm755 built/bin/watchmanctl /usr/local/bin/watchmanctl \
 && mkdir -p /usr/local/var/run/watchman \
 && chmod 2777 /usr/local/var/run/watchman \
 && rm -rf /tmp/watchman

WORKDIR /app

ENV MIX_ENV=dev \
    PHX_SERVER=true

EXPOSE 4225

CMD ["mix", "phx.server"]
