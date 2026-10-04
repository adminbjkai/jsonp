# Production deployment

The app is a static SPA. It needs no Node server, database, environment secrets, or runtime API credentials.

## Current setup

- Public address: `https://jsonp.bjk.ai`
- Host nginx site: `/etc/nginx/sites-available/jsonp.bjk.ai.conf`
- Container: `jsonp-web`, managed by `docker-compose.yml` in `/apps/jsonp`
- Upstream: `127.0.0.1:8025` → container port `8080`
- Limits: 64 MiB memory, 0.5 CPU, 32 processes; one nginx worker
- Security: non-root nginx user, read-only filesystem, 16 MiB temporary mount, all capabilities dropped
- Health check: `/health`, every 30 seconds
- Logging: no per-request access log; rotated container error logs (2 × 5 MiB)

Host infrastructure values come from `/etc/bjk/deploy.env`; its port range is 8000–8999. The existing host nginx configuration retains its wildcard certificate paths and security headers. No firewall ports or certificates are created. The former `jsonp.service` preview process is retired after switching and verifying the new upstream.

## Build and release

For routine releases after the host nginx migration, run `./scripts/deploy.sh`. It checks the app and runs browser tests against the production build, tags the running image for rollback, builds/recreates the container, and runs browser checks against it. Failed health or browser checks restore the previous image when available. Install Chromium with `npx playwright install chromium` before using the script.

The equivalent manual steps are:

```sh
npm ci
npm run check
CI=true npm run test:e2e
docker compose build
docker compose up -d --wait
curl --fail http://127.0.0.1:8025/health
TEST_URL=http://127.0.0.1:8025 npm run test:e2e
```

For an existing deployment using port 8025, no host nginx changes are required. When migrating from a different backend, back up the site's configuration, change only its `proxy_pass` target after the new backend is healthy, run `sudo nginx -t`, and reload nginx. Keep the old backend running until public HTTPS checks succeed.

```sh
curl --fail https://jsonp.bjk.ai/health
TEST_URL=https://jsonp.bjk.ai npm run test:e2e
docker compose ps
docker stats --no-stream jsonp-web
```

The multi-stage Dockerfile installs locked dependencies and builds the app, then copies only static assets into nginx. Base images are pinned by digest; update and test these pins deliberately. `vendor/xlsx-0.20.3.tgz` is required during `npm ci`. The public bundle has no external font or AI requests.

`/assets/` responses are cached for one year with content hashes. HTML is revalidated. Missing assets return 404 instead of HTML. Unknown application routes fall back to the SPA. The content security policy permits local scripts/workers and inline styles needed for positioning graph/virtualized rows.

## Rollback

Before subsequent releases, tag the working image:

```sh
docker image tag jsonp-web:latest jsonp-web:rollback
```

If a replacement fails, restore that image and recreate the service without building:

```sh
docker image tag jsonp-web:rollback jsonp-web:latest
docker compose up -d --no-build --wait
```

Migration backups are kept outside the repository under `/var/backups/jsonp/`. They contain the original host nginx configuration and service definition. Restoring the retired Vite service also requires building the older repository revision with its corresponding dependencies; the new revision no longer ships those unused packages. Refresh already-open browser tabs after a release to use the new content-hashed chunks.
