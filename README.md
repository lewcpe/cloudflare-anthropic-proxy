# Cloudflare Worker Anthropic-to-Workers-AI Proxy

A Cloudflare Worker proxy that exposes Cloudflare Workers AI model `@cf/zai-org/glm-5.3-flash` as `claude-sonnet-5` and translates the **Anthropic Messages API** (`/v1/messages`).

It lets clients built for the Anthropic API (the official Anthropic SDKs, LiteLLM, OpenCode, VS Code extensions) interface directly with `@cf/zai-org/glm-5.3-flash` via Cloudflare Workers AI `env.AI`.

---

## Security Model

**The proxy spends your Cloudflare Workers AI quota on behalf of whoever can reach it.** `*.workers.dev` hostnames are enumerable and routinely scanned, so it is designed to fail closed:

- **`PROXY_API_KEY` is required.** Callers present it via `x-api-key` or `Authorization: Bearer`. Without the secret configured, the worker serves `500` rather than becoming an open relay. Comparison is constant-time over SHA-256 digests.
- **Model ids are validated** against an anchored pattern.
- **CORS is off by default.** Set `ALLOWED_ORIGINS` only if a browser needs to call the proxy directly.
- **Request bodies are capped** (`MAX_REQUEST_BYTES`) and **upstream calls time out** (`UPSTREAM_TIMEOUT_MS`).
- **Optional model allow list** via `ALLOWED_MODELS` restricts which upstream models callers may select.

`/health` is intentionally unauthenticated for uptime checks and reveals no configuration.

---

## Features

- **Anthropic Messages API compatibility** — `/v1/messages` and `/messages`, non-streaming JSON and SSE streaming.
- **Exposed Model** — Exposes model as `claude-sonnet-5` by default while proxying `@cf/zai-org/glm-5.3-flash`.
- **Token counting** — `/v1/messages/count_tokens`.
- **Model discovery** — `GET /v1/models` in Anthropic's list shape.
- **JSON Schema sanitizer** — inlines `$ref`, merges `allOf`, and cleans up parameter schemas for tool calls.
- **Error mapping** — Upstream errors become standard Anthropic error objects.

---

## Example Worker Code Usage

Inside a Cloudflare Worker using the `AI` binding:

```typescript
export interface Env {
  AI: Ai;
}

export default {
  async fetch(request, env): Promise<Response> {
    const messages = [
      { role: "system", content: "You are a friendly assistant" },
      {
        role: "user",
        content: "What is the origin of the phrase Hello, World",
      },
    ];

    const stream = await env.AI.run("@cf/zai-org/glm-5.3-flash", {
      messages,
      stream: true,
    });

    return new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
  },
} satisfies ExportedHandler<Env>;
```

---

## Quick Start

```bash
npm install
```

Create `.dev.vars` for local development:

```env
MODEL_ID=@cf/zai-org/glm-5.3-flash
GATEWAY_ID=tests
PROXY_API_KEY=a_long_random_string_clients_must_present
```

Run tests and dev server:

```bash
npm run dev     # http://localhost:8787
npm test        # offline unit suite
npm run lint    # biome
```

### Deploy

```bash
npx wrangler secret put PROXY_API_KEY
npm run deploy
```

---

## License

MIT
