#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci
npm run check
npm run test:e2e
npm audit --audit-level=low

# Preserve the image actually running, rather than an unrelated latest build.
previous_image=$(docker inspect jsonp-web --format '{{.Image}}' 2>/dev/null || true)
if [[ -n "$previous_image" ]]; then
  docker image tag "$previous_image" jsonp-web:rollback
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
