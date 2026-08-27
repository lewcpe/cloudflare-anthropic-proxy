import { authorize } from "./auth.js";
import { corsHeaders, errorResponse, jsonResponse, readJsonBody } from "./http.js";
import { modelCatalog, resolveModel } from "./models.js";
import { toWorkersAiMessages, toWorkersAiRequest } from "./translate/request.js";
import { toAnthropicResponse } from "./translate/response.js";
import { translateStream } from "./translate/stream.js";

const DEFAULT_MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 300_000;

const MESSAGES_PATHS = new Set(["/v1/messages", "/messages"]);
const COUNT_TOKENS_PATHS = new Set(["/v1/messages/count_tokens", "/messages/count_tokens"]);
const MODELS_PATHS = new Set(["/v1/models", "/models"]);
const HEALTH_PATHS = new Set(["/", "/health"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Unauthenticated health check so uptime monitors work.
    if (request.method === "GET" && HEALTH_PATHS.has(url.pathname)) {
      return jsonResponse({ ok: true, upstream: "cloudflare-workers-ai" }, cors);
    }

    const isKnownRoute =
      (request.method === "POST" && (MESSAGES_PATHS.has(url.pathname) || COUNT_TOKENS_PATHS.has(url.pathname))) ||
      (request.method === "GET" && MODELS_PATHS.has(url.pathname));
    if (!isKnownRoute) {
      return errorResponse(404, "not_found_error", `unknown route: ${request.method} ${url.pathname}`, cors);
    }

    const auth = await authorize(request, env);
    if (!auth.ok) {
      return errorResponse(auth.status, auth.type, auth.message, cors);
    }

    if (request.method === "GET") {
      return jsonResponse(modelCatalog(env), cors);
    }
    if (COUNT_TOKENS_PATHS.has(url.pathname)) {
      return handleCountTokens(request, env, cors);
    }
    return handleMessages(request, env, cors);
  },
};

async function handleMessages(request, env, cors) {
  const prepared = await prepareRequest(request, env, cors);
  if (prepared.response) return prepared.response;
  const { body, targetModel, workersAiPayload } = prepared;

  if (!env.AI || typeof env.AI.run !== "function") {
    return errorResponse(500, "api_error", "env.AI Workers AI binding is not configured", cors);
  }

  const streaming = body.stream === true;
  workersAiPayload.stream = streaming;

  const timeoutMs = positiveInteger(env.UPSTREAM_TIMEOUT_MS) ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), timeoutMs);
  const clearTimer = () => clearTimeout(timer);

  const gatewayId =
    (typeof env.GATEWAY_ID === "string" ? env.GATEWAY_ID.trim() : "") ||
    (typeof env.AI_GATEWAY_ID === "string" ? env.AI_GATEWAY_ID.trim() : "");

  const aiOptions = { signal: controller.signal };
  if (gatewayId) {
    aiOptions.gateway = { id: gatewayId };
    if (env.GATEWAY_SKIP_CACHE === "true" || env.GATEWAY_SKIP_CACHE === true) {
      aiOptions.gateway.skipCache = true;
    }
    const ttl = positiveInteger(env.GATEWAY_CACHE_TTL);
    if (ttl != null) {
      aiOptions.gateway.cacheTtl = ttl;
    }
  }

  try {
    const aiResult = await env.AI.run(targetModel, workersAiPayload, aiOptions);
    clearTimer();

    if (streaming) {
      const upstreamStream = aiResult instanceof Response ? aiResult.body : aiResult;
      const stream = translateStream(upstreamStream, {
        model: body.model,
        stopSequences: Array.isArray(body.stop_sequences) ? body.stop_sequences.filter((s) => typeof s === "string" && s) : [],
        abortController: controller,
      });
      return new Response(stream, {
        status: 200,
        headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
      });
    }

    const rawResult = aiResult instanceof Response ? await aiResult.json() : aiResult;
    const responsePayload = toAnthropicResponse(rawResult, body.model, body.stop_sequences);
    return jsonResponse(responsePayload, cors);
  } catch (err) {
    clearTimer();
    if (controller.signal.aborted) {
      return errorResponse(504, "api_error", `Workers AI did not respond within ${timeoutMs}ms`, cors);
    }
    return errorResponse(502, "api_error", `failed to run Workers AI model: ${err?.message ?? err}`, cors);
  }
}

async function handleCountTokens(request, env, cors) {
  const prepared = await prepareRequest(request, env, cors, { requireMaxTokens: false });
  if (prepared.response) return prepared.response;
  const { body } = prepared;

  const messages = toWorkersAiMessages(body.messages, body.system);
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    }
  }
  const estimatedTokens = Math.max(1, Math.ceil(totalChars / 3.8));

  return jsonResponse({ input_tokens: estimatedTokens }, cors);
}

async function prepareRequest(request, env, cors, { requireMaxTokens = true } = {}) {
  const maxBytes = positiveInteger(env.MAX_REQUEST_BYTES) ?? DEFAULT_MAX_REQUEST_BYTES;
  const parsed = await readJsonBody(request, maxBytes);
  if (parsed.error) {
    return { response: errorResponse(parsed.error.status, parsed.error.type, parsed.error.message, cors) };
  }
  const body = parsed.value;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { response: errorResponse(400, "invalid_request_error", "body must be a JSON object", cors) };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { response: errorResponse(400, "invalid_request_error", "messages: Field required", cors) };
  }
  if (body.model != null && typeof body.model !== "string") {
    return { response: errorResponse(400, "invalid_request_error", "model: Input should be a valid string", cors) };
  }
  if (requireMaxTokens) {
    if (body.max_tokens == null) {
      return { response: errorResponse(400, "invalid_request_error", "max_tokens: Field required", cors) };
    }
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) {
      return {
        response: errorResponse(400, "invalid_request_error", "max_tokens: Input should be a positive integer", cors),
      };
    }
  }

  const requestedModel = body.model ?? "claude-sonnet-5";
  const resolved = resolveModel(requestedModel, env);
  if (resolved.error) {
    return { response: errorResponse(resolved.error.status, resolved.error.type, resolved.error.message, cors) };
  }

  const workersAiPayload = toWorkersAiRequest(body, { maxOutputTokens: env.MAX_OUTPUT_TOKENS });
  if (workersAiPayload.messages.length === 0) {
    return {
      response: errorResponse(400, "invalid_request_error", "messages: no translatable content in any message", cors),
    };
  }

  return { body, targetModel: resolved.model, workersAiPayload };
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
