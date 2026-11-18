# Contributing

Small fixes, clearer documentation, and focused pull requests are welcome.
Describe the problem, the change, and how you checked it. Use invented data in
examples and tests; never include account exports, tokens, or personal finances.

## Development

Use Node.js 24+ and the pnpm version pinned in `package.json`:

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs TypeScript checks, tests, a build, and plugin validation. Tests
use mocked YNAB responses and local HTTP/stdio connections. They need no YNAB
account, credentials, or running Docker service.

To run a development server, follow the [Node setup](docs/operations.md#run-without-docker),
then use `pnpm dev` with `YNAB_ACCESS_TOKEN_FILE` and `MCP_AUTHORIZATION_FILE` set.
The development command does not load `.env`; export any other settings you need.

With a configured server already running, `pnpm smoke` checks the MCP connection
and performs a real read of the YNAB plan list. It prints no budget data and makes
no edits. It uses localhost port 3000 and `.secrets/mcp-authorization` by default;
set `YNAB_MCP_URL` and `YNAB_MCP_AUTHORIZATION_FILE` to override them.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | HTTP server, MCP tools, configuration, and YNAB client |
| `tests/` | Unit and transport tests with synthetic fixtures |
| `plugin/ynab-local/` | Plugin manifest and dependency-free desktop bridge |
| `scripts/` | Setup, checks, packaging, and live smoke check |
| `schemas/` | Agent Plugins schemas used for local validation |
| `docs/` | Client setup and server reference guides |

## Build distributable packages

```sh
pnpm plugin:build
pnpm server:package
```

The desktop ZIP and marketplace appear under `artifacts/`. The source ZIP is
`artifacts/ynab-local-server.zip`; extract it and run setup inside `ynab-local/`
on the host. Packages include the MIT license; the source ZIP also includes
[third-party notices](THIRD_PARTY_NOTICES.md). The source packager selects source
files explicitly and leaves out credentials, dependencies, and build output.

For a package that references an existing ChatGPT connection, see the
[ChatGPT guide](docs/chatgpt.md#optional-package-the-registered-connection).

## Before sharing changes

Run `pnpm check` and review the files you intend to commit. Keep `.env`, `env`,
`.secrets/`, dependency caches, and generated `artifacts/` out of Git. Share a
source ZIP from `pnpm server:package` instead of zipping your working directory.
A package for your registered ChatGPT connection contains your app ID; others
should register their own connection.

GitHub Actions runs the same checks and packages on pushes and pull requests.
It uses synthetic data only. Live YNAB access, Docker deployment, and ChatGPT
installation need separate verification on the deployment host.

Contributions are provided under the project's [MIT license](LICENSE).
