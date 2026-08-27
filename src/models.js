// Model validation and routing
// Anchored pattern to prevent directory traversal or query injection if interpolated.
const MODEL_ID_PATTERN = /^[a-zA-Z0-9_/@-](?:[a-zA-Z0-9._/@-]*[a-zA-Z0-9_/@-])?$/;

export function isValidModelId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && MODEL_ID_PATTERN.test(value) && !value.includes("..");
}

export function resolveModel(requested, env) {
  if (typeof requested !== "string" || !requested || !isValidModelId(requested)) {
    return { error: { status: 400, type: "invalid_request_error", message: `model: invalid model id "${requested}"` } };
  }

  const configuredDefault = env.MODEL_ID || "@cf/zai-org/glm-5.3-flash";
  const isDirectModel = requested.startsWith("@cf/") || requested.startsWith("glm-");
  const candidate = isDirectModel ? requested : configuredDefault;

  if (typeof candidate !== "string" || candidate === "") {
    return { error: { status: 500, type: "api_error", message: "MODEL_ID is not configured" } };
  }
  if (!isValidModelId(candidate)) {
    return { error: { status: 400, type: "invalid_request_error", message: `model: invalid model id "${candidate}"` } };
  }

  const allowList = parseAllowList(env.ALLOWED_MODELS);
  if (allowList && !allowList.includes(candidate)) {
    return {
      error: { status: 403, type: "permission_error", message: `model: "${candidate}" is not in ALLOWED_MODELS` },
    };
  }

  return { model: candidate };
}

function parseAllowList(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const ALIAS_MODELS = [
  { id: "claude-sonnet-5", display_name: "Claude Sonnet 5 (alias -> configured Workers AI model)" },
  { id: "claude-3-7-sonnet-20250219", display_name: "Claude Sonnet 3.7 (alias -> configured Workers AI model)" },
  { id: "claude-3-5-sonnet-20241022", display_name: "Claude Sonnet 3.5 (alias -> configured Workers AI model)" },
];

const CF_MODELS = [{ id: "@cf/zai-org/glm-5.3-flash", display_name: "GLM 5.3 Flash (@cf/zai-org/glm-5.3-flash)" }];

const CREATED_AT = "2026-01-01T00:00:00Z";

export function modelCatalog(env) {
  const seen = new Set();
  const entries = [];
  for (const entry of [...ALIAS_MODELS, ...CF_MODELS]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  const configured = env?.MODEL_ID || "@cf/zai-org/glm-5.3-flash";
  if (isValidModelId(configured) && !seen.has(configured)) {
    entries.unshift({ id: configured, display_name: configured });
  }

  const data = entries.map((entry) => ({
    type: "model",
    id: entry.id,
    display_name: entry.display_name,
    created_at: CREATED_AT,
  }));

  return {
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  };
}
