# YNAB Local MCP

Connect your YNAB budget to an AI assistant through the Model Context Protocol
(MCP). Run the server on your computer, home server, or NAS, then connect an MCP
client to review accounts, categories, transactions, and upcoming bills.

- **Read-only by default**, with 13 tools for exploring your budget.
- **Optional edits** to create transactions, update transactions, and set monthly
  category assignments. Each edit starts with a preview.
- **Self-hosted**, with Docker Compose and a local desktop bridge included.

This is an independent project, not an official YNAB product. Each server connects
to one owner's YNAB account. It does not need an OpenAI API key unless you choose
the optional ChatGPT tunnel.

## Quick start with Docker

You need a YNAB account, Docker with Compose v2 or later, and outbound internet
access. The shell commands below work on macOS, Linux, or WSL.

### 1. Get the source and create the configuration

Clone this repository using the URL from GitHub's **Code** button, or choose
**Download ZIP** and extract it. Open a terminal in the folder containing
`compose.yaml`.

If you have Node.js 24 or later:

```sh
node scripts/setup.mjs
```

Otherwise, run setup through Docker:

```sh
docker run --rm --user "$(id -u):$(id -g)"   -v "$PWD:/work" -w /work node:24-bookworm-slim node scripts/setup.mjs
```

Setup creates `.env` for settings and `.secrets/` for credentials. It preserves
existing files, so you can run it again safely.

### 2. Add your YNAB token

In the [YNAB web app](https://app.ynab.com/), open **Account Settings → Developer
Settings → Personal Access Tokens** and create a token. Open
`.secrets/ynab-token` in a local text editor and replace the placeholder with only
the token. Save the file. See [YNAB's token guide](https://api.ynab.com/#personal-access-tokens)
if you need help finding it.

Keep `.secrets/` and `.env` private. They are excluded from Git and the generated
source archive. Your desktop client uses the separate, generated
`mcp-authorization` file; it does not need your YNAB token.

### 3. Start the server

```sh
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/healthz
```

The health check should return:

```json
{"status":"ok","service":"ynab-local-mcp"}
```

This confirms the server is running. The first YNAB tool call in the next step
confirms that your token works. Port 3000 is available only on the host computer.

### 4. Connect your assistant

Choose the guide for your client:

| Client | Setup |
| --- | --- |
| Local MCP client or desktop app | [Connect a local client](docs/clients.md) |
| ChatGPT on the web | [Connect through a private tunnel](docs/chatgpt.md) |

Once connected, ask: **“List my YNAB budgets and their currencies.”** This calls
`ynab_list_plans` without changing anything. YNAB calls budgets *plans* in its API.

Then try “Review this month's overspending” or “Show my upcoming transactions.”

## Enable edits (optional)

Set `YNAB_ENABLE_WRITES=true` in `.env`, then recreate the server:

```sh
docker compose up -d --force-recreate ynab-mcp
```

Reconnect your client or refresh its tools. Edits default to previews; saving
requires `dry_run=false`. Review the proposed changes before approving them in
your client. See the [tool guide](docs/tools.md) for supported edits and limits.

To turn edits off, set the value back to `false` and recreate the server again.

## Privacy

Anyone with access to this server can read the connected account's allowed plans
and, if enabled, edit them. Use it for your own account, not as a shared service
for unrelated users. Tool results are sent to the assistant you connect.

The server keeps a short-lived memory cache, has no database, and does not log
request bodies. Keep the default loopback binding; use an SSH forward or the
private tunnel for remote access. See [networking and privacy](docs/operations.md).

## More help

- [Configuration, running without Docker, and troubleshooting](docs/operations.md)
- [Available tools, money formats, and edit behavior](docs/tools.md)
- [Development, checks, and packaging](CONTRIBUTING.md)

## License

Project code is [MIT licensed](LICENSE). Bundled schemas retain their
[upstream license](THIRD_PARTY_NOTICES.md).
