# Connect a local MCP client

Start the server using the [quick start](../README.md#quick-start-with-docker).
You also need Node.js 24 or later on the computer running your MCP client.

The included bridge connects a local client's standard input/output (stdio) to
the server's HTTP endpoint. It has no dependencies to install.

## 1. Configure the connection

Create `~/.config/ynab-mcp/client.json` on your desktop:

```sh
mkdir -p ~/.config/ynab-mcp
```

Save this JSON in that file, replacing the example path with an absolute path:

```json
{
  "url": "http://127.0.0.1:3000/mcp",
  "authorization_file": "/absolute/path/to/ynab-mcp/.secrets/mcp-authorization"
}
```

Use the `mcp-authorization` file generated during setup. It contains the full
`Bearer …` header. Do not put your YNAB token here. The bridge does not expand `~`
in paths inside JSON.

If the server runs on another computer, follow [the SSH instructions below](#server-on-a-nas-or-another-computer)
first. If you changed the server port, update `url` too.

## 2. Register the bridge

In a client that accepts an `mcpServers` configuration, add:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "node",
      "args": ["/absolute/path/to/ynab-mcp/plugin/ynab-local/scripts/connect.mjs"]
    }
  }
}
```

Replace the path with your checkout location. The configuration file location
varies by client; merge this entry with any existing servers. If your desktop app
cannot find `node`, use the absolute path returned by `command -v node`.

Restart or reconnect the client, then ask it to list your YNAB budgets and their
currencies. A successful `ynab_list_plans` result confirms both connections.

## Optional: install the desktop plugin

For a client that supports local Agent Plugins marketplaces, install the
[development dependencies](../CONTRIBUTING.md#development), then run:

```sh
pnpm plugin:build
codex plugin marketplace add ./artifacts/ynab-desktop-marketplace
```

The second command needs the Codex CLI. Restart the desktop app, open its Plugins
directory, select the **YNAB Local** marketplace, and install the plugin. Keep the
same `client.json` from step 1. See the [official packaging guide](https://developers.openai.com/plugins/build/plugins)
for supported clients and marketplace options.

## Server on a NAS or another computer

Keep the server's default loopback binding and open an SSH forward on your desktop:

```sh
ssh -N -L 3000:127.0.0.1:3000 YOUR_USER@YOUR_SERVER
```

Leave that terminal running while using the client. Copy only the server's
`.secrets/mcp-authorization` file to a private location on your desktop over a
secure connection, set its permissions to `600` with `chmod`, and reference that
copy in `client.json`. The YNAB token stays on the server.

If local port 3000 is busy, use `-L 3001:127.0.0.1:3000` and change the client URL
to port 3001. If you changed the server's port, change the final port in `-L` too.

For a direct remote connection, use your own trusted HTTPS reverse proxy. The
bridge refuses plain HTTP except on loopback addresses. See [networking](operations.md#networking).

## Other connection options

| Environment variable | Overrides |
| --- | --- |
| `YNAB_MCP_CLIENT_CONFIG` | Location of `client.json` |
| `YNAB_MCP_URL` | Server URL |
| `YNAB_MCP_AUTHORIZATION_FILE` | Path to the MCP authorization file |

Clients with native Streamable HTTP support can connect directly to `/mcp` and
send the full authorization file value as their `Authorization` header. Store it
using the client's private credential settings. This server does not provide
OAuth or a legacy SSE endpoint.

A local desktop connection does not make the server reachable from ChatGPT on
the web. Use the [ChatGPT guide](chatgpt.md) for that route.
