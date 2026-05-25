FROM hub.jawsbite.com/library/python:3.10-alpine AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENV=/app/.venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

WORKDIR /app

# Pin to a specific version for reproducible builds, e.g. ghcr.io/astral-sh/uv:0.x.y
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY opensandbox_server ./opensandbox_server
COPY LICENSE README.md ./

# Install the project as a wheel (non-editable) so the runtime stage needs no source copy
RUN uv sync --frozen --no-dev --no-editable

FROM hub.jawsbite.com/library/python:3.10-alpine AS runtime

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENV=/app/.venv \
    PATH="/app/.venv/bin:${PATH}" \
    SANDBOX_CONFIG_PATH=/etc/opensandbox/config.toml

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY config.toml /etc/opensandbox/config.toml

EXPOSE 8090

ENTRYPOINT ["opensandbox-server"]
CMD ["--config", "/etc/opensandbox/config.toml"]
