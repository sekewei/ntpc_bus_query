# NTPC Bus Route Worker

A Cloudflare Worker that looks up New Taipei City bus routes and returns the ordered stop list for a requested direction, together with the latest ETA information from the NTPC open-data feeds.

## Live demo

- GitHub Pages demo: https://sekewei.github.io/ntpc_bus_query/
- Remote Worker: https://ntpc-bus-query.sekewei.workers.dev/health

## Required runtime

This project is intended for Node.js 22 or newer.

- Recommended: Node.js 22 LTS
- Compatibility note: the local Windows startup script checks for Node 22+
- Version pin: see [.nvmrc](.nvmrc)

## Repository purpose

The worker does the following:

- loads route metadata and stop sequences from the NTPC CSV feeds
- normalizes route aliases such as `R28`, `紅28`, and `red 28`
- resolves the correct route ID and direction
- fetches the latest ETA CSV for that route
- returns a JSON response with route metadata, ordered stops, and waiting-time text

## Local development

From the repository root:

```bat
run.bat
```

Optional reset mode when local Wrangler state is stale:

```bat
run.bat reset
```

This starts the worker locally with Wrangler on `http://127.0.0.1:8787`.

## Deploy to Cloudflare

```bat
deploy.bat
```

The deployment script runs `npx wrangler deploy` for the current project.

## Smoke test

```bat
node scripts/test-client.mjs "R28" 0
```

Or with the deployed worker:

```bat
set BASE_URL=https://ntpc-bus-query.sekewei.workers.dev
node scripts/test-client.mjs "R28" 0
```

## Project layout

- `src/index.ts` - Worker entry point and route handler
- `src/busData.ts` - route/stop indexing and alias normalization
- `src/csv.ts` - CSV parsing helper
- `scripts/test-client.mjs` - quick client smoke test
- `scripts/upload.mjs` - upload secrets and deploy
- `design/ntpc_api_spec.md` - API design and implementation notes
- `run.bat` - local Worker launcher with optional reset mode
- `deploy.bat` - Cloudflare deployment script

## Notes

- The worker is designed for New Taipei City bus data.
- The local reset mode exists to clear stale Wrangler process/cache state on Windows machines; it should not be the default development path.
- The deployed Worker is the authoritative runtime for validation and demo use.
