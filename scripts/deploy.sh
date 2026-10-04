#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci
npm run check
CI=true npm run test:e2e
npm audit --audit-level=low

# Preserve the image actually running, rather than an unrelated latest build.
previous_image=$(docker inspect jsonp-web --format '{{.Image}}' 2>/dev/null || true)
if [[ -n "$previous_image" ]] && ! docker image tag "$previous_image" jsonp-web:rollback 2>/dev/null; then
  # The running image can be untagged and pruned (e.g. after a manual build). Fall back to an
  # existing rollback tag rather than deploying without one.
  if docker image inspect jsonp-web:rollback >/dev/null 2>&1; then
    echo "warning: running image is unavailable; keeping the existing jsonp-web:rollback" >&2
  else
    echo "error: no rollback image available; build one before deploying" >&2
    exit 1
  fi
fi

docker compose build
if ! docker compose up -d --wait --wait-timeout 60; then
  if [[ -n "$previous_image" ]]; then
    docker image tag jsonp-web:rollback jsonp-web:latest
    docker compose up -d --no-build --wait --wait-timeout 60
  fi
  exit 1
fi

if ! TEST_URL=http://127.0.0.1:8025 npm run test:e2e; then
  if [[ -n "$previous_image" ]]; then
    docker image tag jsonp-web:rollback jsonp-web:latest
    docker compose up -d --no-build --wait --wait-timeout 60
  fi
  exit 1
fi
curl --fail --silent --show-error http://127.0.0.1:8025/health
