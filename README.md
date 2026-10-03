# SSL Monitor MCP

SSL Monitor is a focused certificate/TLS monitoring service with a shared domain/SSL core, REST API, authenticated dashboard, independent background worker, and authenticated MCP server.

## Architecture

- **Web:** React + Vite + TypeScript
- **API:** Node.js + Fastify + TypeScript
- **Worker:** Independent background monitoring worker
- **MCP:** Official TypeScript MCP SDK with Streamable HTTP transport
- **Database:** PostgreSQL / Neon
- **Authentication:** Argon2id passwords + short-lived JWTs
- **Domain security:** Centralized DNS/SSRF-safe TLS inspection
- **Notifications:** Webhooks + optional SMTP email

The Web, API, Worker, and MCP layers use the same shared domain/application services. Business logic is not duplicated between interfaces.

## Quick start

Install dependencies:

```bash
npm install
```
