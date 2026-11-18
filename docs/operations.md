# Configure and run the server

For the first installation, use the [quick start](../README.md#quick-start-with-docker).

## Configuration

Docker Compose reads `.env`. After changing it, apply the settings with:

```sh
docker compose up -d --force-recreate ynab-mcp
```

| Setting | Default | Purpose |
| --- | --- | --- |
| `YNAB_ENABLE_WRITES` | `false` | Set exactly `true` to enable the three edit tools |
| `YNAB_DEFAULT_PLAN_ID` | Empty | Default plan UUID for read tools |
| `YNAB_ALLOWED_PLAN_IDS` | Empty (all plans) | Comma-separated plan UUIDs clients may access |
| `PORT` | `3000` | Host port; the Compose container always uses port 3000 |
| `BIND_ADDRESS` | `127.0.0.1` | Host address on which Compose publishes the port |
| `PUID`, `PGID` | Current user/group after setup | User and group that run the containers |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1],ynab-mcp` | Allowed hostnames or IPs, without scheme or port |
| `MCP_ALLOWED_ORIGINS` | Empty | Comma-separated browser origins; other origins are rejected |
| `OPENAI_TUNNEL_ID` | Empty | Tunnel ID for the optional `chatgpt` profile |
| `TUNNEL_CLIENT_IMAGE` | `ghcr.io/openai/tunnel-client:v0.0.15` | Tunnel client image |

To limit access to one budget, call `ynab_list_plans`, copy its UUID into
`YNAB_ALLOWED_PLAN_IDS`, and optionally use the same UUID for
`YNAB_DEFAULT_PLAN_ID`. A default must be in the allowlist. Names and `last-used`
are not accepted in place of UUIDs.

### Process settings

These are environment variables read by the Node process. The supplied Compose
file sets the two file paths and `HOST` for you. To change the timeout or cache in
Docker, add them to the service's `environment` section.

| Setting | Default | Purpose |
| --- | --- | --- |
| `YNAB_ACCESS_TOKEN_FILE` | Required by the supplied setup | File containing only the YNAB token |
| `MCP_AUTHORIZATION_FILE` | Required by the supplied setup | File containing `Bearer ` and the generated MCP token |
| `HOST` | `127.0.0.1` | Listener address; Compose uses `0.0.0.0` inside the container |
| `YNAB_CACHE_TTL_SECONDS` | `30` | Read-cache lifetime, from 0 to 300 seconds |
| `YNAB_TIMEOUT_SECONDS` | `15` | YNAB request timeout, from 1 to 60 seconds |

For managed environments, `YNAB_ACCESS_TOKEN`, `MCP_AUTHORIZATION`, and
`MCP_AUTH_TOKEN` (raw MCP token) also accept values directly, or through their
`_FILE` variants. Set only one form per setting, and only one of the MCP settings.
Use file references for manual setup to keep values out of command history.

## Run without Docker

Install Node.js 24+ and the pinned pnpm version, then run from the project folder:

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
node scripts/setup.mjs
```

Replace the placeholder in `.secrets/ynab-token` as described in the quick start.
Then build and start:

```sh
pnpm build
YNAB_ACCESS_TOKEN_FILE=.secrets/ynab-token MCP_AUTHORIZATION_FILE=.secrets/mcp-authorization node --env-file=.env dist/index.js
```

Leave the process running and connect a [local client](clients.md). Stop it with
Ctrl+C. Node does not load `.env` automatically; `--env-file` explicitly loads it
here. Docker-only settings such as `PUID` and `BIND_ADDRESS` have no effect in this
mode. Set `HOST` to change the Node listener address.

## Networking

Keep port 3000 bound to loopback. For a NAS, use an [SSH forward](clients.md#server-on-a-nas-or-another-computer)
or the [ChatGPT tunnel](chatgpt.md). Do not forward this port from your router.

With your own HTTPS reverse proxy, forward `Authorization` and either preserve
an allowed Host header or add the proxy hostname to `MCP_ALLOWED_HOSTS`. The
server does not trust `X-Forwarded-Host`. Only allow specific trusted browser
origins if your client needs them; wildcards are not supported.

The endpoint is stateless Streamable HTTP at `/mcp`. Opening it in a browser is
not a connection test: unauthenticated requests return 401, and an authenticated
GET can return 405. Use a tool call instead. OAuth and legacy SSE are not provided.

## Credentials and privacy

Setup creates `.secrets/` with mode `700` and new files with mode `600`. Run setup
as an ordinary user on the host. Both containers use that user's `PUID:PGID` to
read the files. If moving to a NAS, adjust ownership and those IDs for the new
host. Existing permissions are preserved. Compose secrets are local files, not
an encrypted vault.

To rotate access, replace the relevant credential locally and recreate its
service. For the MCP credential, also update desktop copies and recreate the
tunnel if used. A YNAB token can be revoked in YNAB's Developer Settings.

The server does not persist budget data or log request bodies. The assistant,
proxy, and tunnel you connect may have their own data policies. Avoid HTTP body
logging and remove financial details before sharing diagnostics.

## Maintenance and troubleshooting

YNAB allows [200 requests per token in a rolling hour](https://api.ynab.com/#rate-limiting).
The server limits itself to 190, caches reads for 30 seconds by default, and
honors rate-limit cooldowns. Other apps using the same token share YNAB's quota.
Restarting the server does not reset that quota.

Writes clear the cache, even when the outcome is uncertain. Requests are not
retried automatically. After a write timeout, check YNAB before retrying and keep
the original create idempotency key. See [edit behavior](tools.md#editing).

| Symptom | What to check |
| --- | --- |
| Server exits at startup | Replace setup placeholders; check file ownership and settings |
| Port already in use | Change `PORT` in `.env` and update the client URL |
| HTTP 401 | Use the MCP authorization file, not the YNAB token |
| HTTP 403 | Allow your trusted browser's exact origin if needed |
| HTTP 421 | Add the intended hostname to `MCP_ALLOWED_HOSTS`, without a port |
| `YNAB_UNAUTHORIZED` | Replace the invalid or revoked YNAB token |
| `PLAN_REQUIRED` / `PLAN_FORBIDDEN` | Supply a plan UUID and check the allowlist |
| `RATE_LIMITED` | Wait for `retry_after_seconds` before trying again |
| `STALE_PREVIEW` | Request and review a fresh preview |
| Desktop bridge will not start | Check Node 24+, absolute paths, and credential-file permissions |

View server logs with `docker compose logs --tail=50 ynab-mcp`. Stop the server
with `docker compose down`, or use `docker compose --profile chatgpt down` when
the tunnel is running too. No application database needs backing up; YNAB remains
the source of truth. Store configuration and credential backups privately.
