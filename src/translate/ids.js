// Anthropic tool_use ids are opaque strings that clients echo back verbatim on tool_result.
const SIG_SEPARATOR = "__ts__";

export function toBase64Url(value) {
  return value.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return padded + "=".repeat((4 - (padded.length % 4)) % 4);
}

export function packToolUseId(functionCall, thoughtSignature) {
  const base = functionCall?.id ?? newToolUseId();
  if (!thoughtSignature || typeof thoughtSignature !== "string") return base;
  return `${base}${SIG_SEPARATOR}${toBase64Url(thoughtSignature)}`;
}

export function unpackToolUseId(id) {
  if (typeof id !== "string" || !id) return { cleanId: null, signature: null };
  const separatorIndex = id.lastIndexOf(SIG_SEPARATOR);
  if (separatorIndex < 0) return { cleanId: id, signature: null };
  const encoded = id.slice(separatorIndex + SIG_SEPARATOR.length);
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return { cleanId: id, signature: null };
  }
  return {
    cleanId: id.slice(0, separatorIndex),
    signature: fromBase64Url(encoded),
  };
}

export function newMessageId() {
  return `msg_${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`;
}

export function newToolUseId() {
  return `toolu_${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`;
}
