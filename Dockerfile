# syntax=docker/dockerfile:1.7

FROM node:lts-bookworm-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV APP_HOME=/app \
  PNPM_HOME=/pnpm \
  COREPACK_ENABLE_PROJECT_SPEC=0 \
  VIRTUAL_ENV=/app/.venv \
  UV_LINK_MODE=copy \
  PATH=/app/.venv/bin:/pnpm/bin:/pnpm:/root/.local/bin:$PATH

WORKDIR ${APP_HOME}

RUN printf '%s\n' \
  'export VIRTUAL_ENV=/app/.venv' \
  'export PNPM_HOME=/pnpm' \
  'export COREPACK_ENABLE_PROJECT_SPEC=0' \
  'path_prepend() {' \
  '  case ":$PATH:" in' \
  '    *":$1:"*) ;;' \
  '    *) PATH="$1:$PATH" ;;' \
  '  esac' \
  '}' \
  'path_prepend /root/.local/bin' \
  'path_prepend /pnpm' \
  'path_prepend /pnpm/bin' \
  'path_prepend /app/.venv/bin' \
  'export PATH' \
  'unset -f path_prepend' \
  > /etc/profile.d/app-runtime.sh

ENV BASH_ENV=/etc/profile.d/app-runtime.sh

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && corepack prepare pnpm@11.5.0 --activate \
  && pnpm runtime set node lts -g

RUN curl -LsSf https://astral.sh/uv/install.sh | sh

COPY pyproject.toml uv.lock ./
RUN uv python install 3.13 \
  && uv venv "${VIRTUAL_ENV}" --python 3.13 \
  && uv sync --frozen --no-dev

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile

COPY . .

RUN pnpm build \
  && pnpm prune --prod

CMD ["node", "src/main.ts"]
