import { unpackToolUseId } from "./ids.js";
import { isEmptyObjectSchema, sanitizeSchema } from "./schema.js";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

export function toWorkersAiRequest(body, options = {}) {
  const messages = toWorkersAiMessages(body.messages, body.system);

  const request = { messages };

  const maxLimit = positiveInteger(options.maxOutputTokens) ?? 8192;
  if (body.max_tokens != null) {
    request.max_tokens = Math.min(body.max_tokens, maxLimit);
  }
  if (body.temperature != null) request.temperature = body.temperature;
  if (body.top_p != null) request.top_p = body.top_p;
  if (body.top_k != null) request.top_k = body.top_k;
  if (body.stream != null) request.stream = Boolean(body.stream);

  const tools = toTools(body.tools);
  if (tools.length > 0) {
    request.tools = tools;
  }

  return request;
}

export function toSystemText(system) {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

export function toWorkersAiMessages(messages, system) {
  const result = [];

  const systemText = toSystemText(system);
  if (systemText) {
    result.push({ role: "system", content: systemText });
  }

  if (!Array.isArray(messages)) return result;

  const toolUseNames = new Map();

  for (const message of messages) {
    const role = message?.role === "assistant" ? "assistant" : "user";
    const { text, toolCalls } = parseMessageBlocks(message?.content, toolUseNames, role);

    const msgObj = { role, content: text };
    if (toolCalls && toolCalls.length > 0) {
      msgObj.tool_calls = toolCalls;
    }

    if (!msgObj.content && (!msgObj.tool_calls || msgObj.tool_calls.length === 0)) continue;

    const last = result[result.length - 1];
    if (last && last.role === role && !last.tool_calls && !msgObj.tool_calls) {
      last.content += `\n\n${msgObj.content}`;
    } else {
      result.push(msgObj);
    }
  }

  return result;
}

function parseMessageBlocks(content, toolUseNames, role) {
  if (typeof content === "string") return { text: content, toolCalls: [] };
  if (!Array.isArray(content)) return { text: "", toolCalls: [] };

  let combinedText = "";
  const toolCalls = [];

  for (const block of content) {
    if (typeof block === "string") {
      combinedText += (combinedText ? "\n" : "") + block;
      continue;
    }
    if (!block || typeof block !== "object") continue;

    switch (block.type) {
      case "text":
        if (typeof block.text === "string" && block.text) {
          combinedText += (combinedText ? "\n" : "") + block.text;
        }
        break;
      case "document": {
        let docContent = "";
        if (typeof block.source?.data === "string") {
          docContent = block.source.data;
        } else if (typeof block.text === "string") {
          docContent = block.text;
        }
        if (docContent) {
          const title = block.title ? ` ${block.title}` : "";
          combinedText += `${combinedText ? "\n\n" : ""}[Document${title}:\n${docContent}]`;
        }
        break;
      }
      case "tool_use": {
        if (block.id && block.name) toolUseNames.set(block.id, block.name);
        const { cleanId } = unpackToolUseId(block.id);
        toolCalls.push({
          id: cleanId || block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
        break;
      }
      case "tool_result": {
        const { cleanId } = unpackToolUseId(block.tool_use_id);
        const name = toolUseNames.get(block.tool_use_id) ?? cleanId ?? "unknown_tool";
        let resText = "";
        if (typeof block.content === "string") {
          resText = block.content;
        } else if (Array.isArray(block.content)) {
          resText = block.content
            .map((item) => {
              if (typeof item === "string") return item;
              if (item?.type === "text" && typeof item.text === "string") return item.text;
              return "";
            })
            .filter(Boolean)
            .join("\n");
        }
        if (block.is_error) resText = `[error] ${resText}`;
        combinedText += `${combinedText ? "\n" : ""}[Tool Result for ${name}]: ${resText}`;
        break;
      }
      default:
        break;
    }
  }

  return { text: combinedText, toolCalls };
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function toTools(tools) {
  if (!Array.isArray(tools)) return [];
  const declarations = [];
  for (const tool of tools) {
    if (!tool?.name || typeof tool.name !== "string") continue;
    const declaration = {
      type: "function",
      function: {
        name: tool.name,
      },
    };
    if (typeof tool.description === "string" && tool.description) {
      declaration.function.description = tool.description;
    }
    if (tool.input_schema && typeof tool.input_schema === "object") {
      const parameters = sanitizeSchema(tool.input_schema);
      if (!isEmptyObjectSchema(parameters)) {
        declaration.function.parameters = parameters;
      }
    }
    declarations.push(declaration);
  }
  return declarations;
}
