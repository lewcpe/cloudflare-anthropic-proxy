import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";

const ENV = {
  MODEL_ID: "@cf/zai-org/glm-5.3-flash",
  PROXY_API_KEY: "proxy-secret",
  AI: {
    run: vi.fn(),
  },
};

const MESSAGE_BODY = { model: "claude-sonnet-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] };

function post(path, body, headers = { "x-api-key": ENV.PROXY_API_KEY }) {
  return new Request(`https://proxy.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function get(path, headers = { "x-api-key": ENV.PROXY_API_KEY }) {
  return new Request(`https://proxy.test${path}`, { method: "GET", headers });
}

beforeEach(() => {
  ENV.AI.run.mockReset();
  ENV.AI.run.mockResolvedValue({
    response: "hello world",
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  });
});

describe("authentication", () => {
  it("rejects a request with no key", async () => {
    const response = await worker.fetch(post("/v1/messages", MESSAGE_BODY, {}), ENV);
    expect(response.status).toBe(401);
    expect((await response.json()).error.type).toBe("authentication_error");
    expect(ENV.AI.run).not.toHaveBeenCalled();
  });

  it("rejects a wrong key", async () => {
    const response = await worker.fetch(post("/v1/messages", MESSAGE_BODY, { "x-api-key": "nope" }), ENV);
    expect(response.status).toBe(401);
    expect(ENV.AI.run).not.toHaveBeenCalled();
  });

  it("accepts x-api-key and Authorization: Bearer alike", async () => {
    for (const headers of [{ "x-api-key": ENV.PROXY_API_KEY }, { authorization: `Bearer ${ENV.PROXY_API_KEY}` }]) {
      const response = await worker.fetch(post("/v1/messages", MESSAGE_BODY, headers), ENV);
      expect(response.status).toBe(200);
    }
  });

  it("fails closed when PROXY_API_KEY is unset", async () => {
    const response = await worker.fetch(post("/v1/messages", MESSAGE_BODY), { ...ENV, PROXY_API_KEY: undefined });
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toMatch(/PROXY_API_KEY/);
    expect(ENV.AI.run).not.toHaveBeenCalled();
  });

  it("guards the models endpoint too", async () => {
    expect((await worker.fetch(get("/v1/models", {}), ENV)).status).toBe(401);
  });

  it("leaves health check open", async () => {
    const response = await worker.fetch(get("/health", {}), ENV);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ ok: true, upstream: "cloudflare-workers-ai" });
  });
});

describe("model resolution", () => {
  it("maps an Anthropic alias onto the configured Workers AI model", async () => {
    await worker.fetch(post("/v1/messages", MESSAGE_BODY), ENV);
    expect(ENV.AI.run).toHaveBeenCalledWith("@cf/zai-org/glm-5.3-flash", expect.objectContaining({ max_tokens: 100 }), expect.any(Object));
  });

  it("refuses a model id with invalid characters", async () => {
    for (const model of ["model/../foo", "model..flash", "model#frag"]) {
      const response = await worker.fetch(post("/v1/messages", { ...MESSAGE_BODY, model }), ENV);
      expect(response.status).toBe(400);
    }
    expect(ENV.AI.run).not.toHaveBeenCalled();
  });

  it("honours a configured allow list", async () => {
    const env = { ...ENV, ALLOWED_MODELS: "@cf/zai-org/glm-5.3-flash" };
    const allowed = await worker.fetch(post("/v1/messages", { ...MESSAGE_BODY, model: "@cf/zai-org/glm-5.3-flash" }), env);
    expect(allowed.status).toBe(200);

    const denied = await worker.fetch(post("/v1/messages", { ...MESSAGE_BODY, model: "@cf/other/model" }), env);
    expect(denied.status).toBe(403);
  });

  it("passes gateway configuration to env.AI.run when GATEWAY_ID is set", async () => {
    const env = { ...ENV, GATEWAY_ID: "tests" };
    await worker.fetch(post("/v1/messages", MESSAGE_BODY), env);
    expect(ENV.AI.run).toHaveBeenCalledWith(
      "@cf/zai-org/glm-5.3-flash",
      expect.anything(),
      expect.objectContaining({
        gateway: { id: "tests" },
      }),
    );
  });
});

describe("request validation", () => {
  const cases = [
    ["missing messages", { max_tokens: 10 }, /messages/],
    ["empty messages", { max_tokens: 10, messages: [] }, /messages/],
    ["missing max_tokens", { messages: [{ role: "user", content: "hi" }] }, /max_tokens/],
    ["non-integer max_tokens", { max_tokens: "10", messages: [{ role: "user", content: "hi" }] }, /max_tokens/],
    ["zero max_tokens", { max_tokens: 0, messages: [{ role: "user", content: "hi" }] }, /max_tokens/],
  ];

  for (const [name, body, pattern] of cases) {
    it(`rejects ${name}`, async () => {
      const response = await worker.fetch(post("/v1/messages", body), ENV);
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toMatch(pattern);
      expect(ENV.AI.run).not.toHaveBeenCalled();
    });
  }

  it("rejects an oversized body", async () => {
    const env = { ...ENV, MAX_REQUEST_BYTES: 200 };
    const big = { ...MESSAGE_BODY, messages: [{ role: "user", content: "x".repeat(5000) }] };
    const response = await worker.fetch(post("/v1/messages", big), env);
    expect(response.status).toBe(413);
    expect(ENV.AI.run).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("returns an Anthropic message", async () => {
    const response = await worker.fetch(post("/v1/messages", MESSAGE_BODY), ENV);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "hello world" }],
      stop_reason: "end_turn",
    });
  });

  it("streams when requested", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"response": "streamed hello"}\n\n'));
        controller.close();
      },
    });
    ENV.AI.run.mockResolvedValueOnce(stream);

    const response = await worker.fetch(post("/v1/messages", { ...MESSAGE_BODY, stream: true }), ENV);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toContain("streamed hello");
  });
});

describe("models endpoint", () => {
  it("returns the Anthropic model list shape", async () => {
    const response = await worker.fetch(get("/v1/models"), ENV);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.has_more).toBe(false);
    expect(payload.data.map((m) => m.id)).toContain("claude-sonnet-5");
  });
});

describe("count_tokens", () => {
  it("estimates input tokens", async () => {
    const response = await worker.fetch(
      post("/v1/messages/count_tokens", { model: "claude-sonnet-5", messages: [{ role: "user", content: "hello world" }] }),
      ENV,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.input_tokens).toBeGreaterThan(0);
  });
});

describe("routing", () => {
  it("404s unknown path", async () => {
    const response = await worker.fetch(get("/unknown"), ENV);
    expect(response.status).toBe(404);
  });
});
