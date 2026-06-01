# syntax=docker/dockerfile:1.7

FROM node:lts-bookworm-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV APP_HOME=/app \
  PNPM_HOME=/pnpm \
  COREPACK_ENABLE_PROJECT_SPEC=0 \
  VIRTUAL_ENV=/app/.venv \
  UV_LINK_MODE=copy \
  PATH=/app/node_modules/.bin:/app/.venv/bin:/pnpm/bin:/pnpm:/root/.local/bin:$PATH

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
  'path_prepend /app/node_modules/.bin' \
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
    ffmpeg \
    file \
    fonts-freefont-ttf \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    git \
    jq \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo-gobject2 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgdk-pixbuf-2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libreoffice \
    poppler-utils \
    python-is-python3 \
    ripgrep \
    wget \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && corepack prepare pnpm@11.5.0 --activate

RUN curl -LsSf https://astral.sh/uv/install.sh | sh

COPY pyproject.toml uv.lock ./
RUN uv python install 3.13 \
  && uv venv "${VIRTUAL_ENV}" --python 3.13 \
  && uv sync --frozen --no-dev

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile

RUN pnpm exec agent-browser install

COPY . .

RUN pnpm build \
  && pnpm prune --prod

CMD ["node", "src/main.ts"]
