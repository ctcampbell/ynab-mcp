# Connect to ChatGPT

ChatGPT on the web cannot reach a localhost or private LAN address. The optional
Secure MCP Tunnel connects it to this server using outbound HTTPS, without
opening a public port.

First complete the [Docker quick start](../README.md#quick-start-with-docker).
You need access to [OpenAI Platform Tunnels](https://platform.openai.com/settings/organization/tunnels)
and permission to add custom MCP plugins in your ChatGPT workspace. If those
features are unavailable, use a [local MCP client](clients.md).

## 1. Create a private tunnel

In Platform Tunnels, create a tunnel associated with the ChatGPT workspace where
you will use YNAB. Creating it requires **Tunnels Read + Manage**; running or
selecting it requires **Tunnels Read + Use**.

Add its ID to `.env`:

```dotenv
OPENAI_TUNNEL_ID=tunnel_REPLACE_WITH_YOUR_ID
```

Create a runtime API key with tunnel-use permission in your OpenAI Platform
organization. Store it in `.secrets/openai-tunnel-key`, replacing the placeholder.
Use a runtime key, not an admin key. This key is only for the tunnel; the YNAB
server makes no OpenAI model calls.

## 2. Start the tunnel

```sh
docker compose --profile chatgpt up -d --build
docker compose --profile chatgpt ps
docker compose logs --tail=50 tunnel
```

Check the logs for a connected tunnel. Keep it running while using ChatGPT. The
Compose configuration already supplies the internal server URL and MCP
authorization header. Review logs locally before sharing them.

## 3. Add the connection in ChatGPT

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins) and select **+ → Add custom MCP server**.
2. Name it **YNAB Local**. Under **Connection**, choose **Tunnel** and select your tunnel.
3. Choose **No authentication** for this dedicated personal connection. The
   tunnel supplies the server's MCP bearer header; this setting skips an
   additional user OAuth flow. Only associate the tunnel with contexts that
   should have access to your YNAB account.
4. Review the connection notice, choose **Create as a plugin**, and install it.
5. In a new chat, select **YNAB Local** and ask “List my YNAB budgets and their currencies.”

A successful tool result confirms the complete connection. A local health check
does not verify ChatGPT access. If the tunnel is missing, check its workspace
association and your Tunnels Read + Use permissions.

## Optional: package the registered connection

The connection above works without a package. To reuse it in a local marketplace,
install the [development dependencies](../CONTRIBUTING.md#development), copy the
`plugin_asdk_app…` ID from its management-page URL, and run:

```sh
pnpm plugin:build --app-id plugin_asdk_app_REPLACE_WITH_YOUR_ID
codex plugin marketplace add ./artifacts/ynab-chatgpt-marketplace
```

This creates `artifacts/ynab-local-chatgpt.zip` and a local marketplace. Restart the
desktop app and install **YNAB Local** from that marketplace. The package points
to your registered connection; it does not grant other accounts access.

A public GitHub source repository lets others run their own server. It does not
make your private tunnel eligible for the public plugin directory.

See the official [tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and [plugin packaging guide](https://developers.openai.com/plugins/build/plugins)
for current access requirements and UI details. The included Compose file pins
the tunnel client to `v0.0.15`; review the official tunnel guide before changing
`TUNNEL_CLIENT_IMAGE` to another version.
