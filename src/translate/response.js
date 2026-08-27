import { newMessageId } from "./ids.js";

export function extractReasoningText(data) {
  if (!data || typeof data !== "object") return "";

  const choicesList = Array.isArray(data.choices) ? data.choices : Array.isArray(data.result?.choices) ? data.result.choices : [];
  if (choicesList.length > 0) {
    const choice = choicesList[0];
    if (choice && typeof choice === "object") {
      if (typeof choice.message?.reasoning_content === "string" && choice.message.reasoning_content) {
        return choice.message.reasoning_content;
      }
      if (typeof choice.delta?.reasoning_content === "string" && choice.delta.reasoning_content) {
        return choice.delta.reasoning_content;
      }
    }
  }

  if (typeof data.delta?.reasoning_content === "string") return data.delta.reasoning_content;
  if (typeof data.reasoning_content === "string") return data.reasoning_content;
  return "";
}

export function extractResponseText(data) {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";

  if (typeof data.response === "string") return data.response;
  if (typeof data.text === "string") return data.text;
  if (typeof data.output === "string") return data.output;
  if (typeof data.generated_text === "string") return data.generated_text;

  // Check choices from Workers AI OpenAI/GLM output format
  const choicesList = Array.isArray(data.choices) ? data.choices : Array.isArray(data.result?.choices) ? data.result.choices : [];
  if (choicesList.length > 0) {
    const choice = choicesList[0];
    if (typeof choice === "string") return choice;
    if (choice && typeof choice === "object") {
      const msg = choice.message;
      const delta = choice.delta;

      if (typeof msg?.content === "string" && msg.content) return msg.content;
      if (typeof delta?.content === "string" && delta.content) return delta.content;

      if (typeof choice.text === "string" && choice.text) return choice.text;
      if (typeof choice.delta === "string" && choice.delta) return choice.delta;
    }
  }

  if (typeof data.delta?.content === "string" && data.delta.content) return data.delta.content;
  if (typeof data.content === "string" && data.content) return data.content;

  if (typeof data.result?.response === "string") return data.result.response;
  if (typeof data.result?.text === "string") return data.result.text;
  if (typeof data.result?.content === "string") return data.result.content;
  if (typeof data.result?.output === "string") return data.result.output;

  return "";
}

export function extractToolCalls(data) {
  if (!data || typeof data !== "object") return [];

  const choicesList = Array.isArray(data.choices) ? data.choices : Array.isArray(data.result?.choices) ? data.result.choices : [];

  const toolCalls = [];

  for (const choice of choicesList) {
    const calls =
      choice?.message?.tool_calls ||
      choice?.tool_calls ||
      (choice?.message?.function_call ? [{ function: choice.message.function_call, id: choice.message.function_call.id }] : []);
    if (Array.isArray(calls)) {
      for (const call of calls) {
        if (!call) continue;
        let args = {};
        const rawArgs = call.function?.arguments ?? call.arguments;
        if (typeof rawArgs === "string") {
          try {
            args = JSON.parse(rawArgs);
          } catch {
            args = {};
          }
        } else if (rawArgs && typeof rawArgs === "object") {
          args = rawArgs;
        }

        const name = call.function?.name ?? call.name ?? "unknown_tool";
        const id = call.id ?? newMessageId().replace("msg_", "toolu_");
        toolCalls.push({
          type: "tool_use",
          id,
          name,
          input: args,
        });
      }
    }
  }

  return toolCalls;
}

const TEXT_TOOL_CALL_REGEX = /\[Tool Call:\s*([a-zA-Z0-9_-]+)\s*\(([\s\S]*?)\)\]/g;
const XML_TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export function parseTextToolCalls(text) {
  if (typeof text !== "string" || !text) return { cleanText: text, toolCalls: [] };

  let cleanText = text;
  const toolCalls = [];

  cleanText = cleanText.replaceAll(TEXT_TOOL_CALL_REGEX, (match, name, rawArgs) => {
    let args = {};
    if (rawArgs?.trim()) {
      try {
        args = JSON.parse(rawArgs.trim());
      } catch {
        args = {};
      }
    }
    toolCalls.push({
      type: "tool_use",
      id: newMessageId().replace("msg_", "toolu_"),
      name: name.trim(),
      input: args,
    });
    return "";
  });

  cleanText = cleanText.replaceAll(XML_TOOL_CALL_REGEX, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      if (parsed?.name) {
        toolCalls.push({
          type: "tool_use",
          id: newMessageId().replace("msg_", "toolu_"),
          name: parsed.name,
          input: parsed.arguments ?? parsed.parameters ?? parsed.input ?? {},
        });
        return "";
      }
    } catch {}
    return match;
  });

  return { cleanText: cleanText.trim(), toolCalls };
}

const DUMMY_THINKING_SIGNATURE = "Eq4BCgIYAhABGkAKHmh0dHBzOi8vYXBpLmFudGhyb3BpYy5jb20vdjEvbWVzc2FnZXMvY29tcGxldGlvbnM=";

export function toAnthropicResponse(workersAiResponse, requestedModel, stopSequences) {
  const reasoning = extractReasoningText(workersAiResponse);
  const rawText = extractResponseText(workersAiResponse);
  const { cleanText, toolCalls: textToolCalls } = parseTextToolCalls(rawText);
  const structuredToolCalls = extractToolCalls(workersAiResponse);
  const toolCalls = [...structuredToolCalls, ...textToolCalls];
  const content = [];

  if (reasoning) {
    content.push({
      type: "thinking",
      thinking: reasoning,
      signature: DUMMY_THINKING_SIGNATURE,
    });
  }
  if (cleanText) {
    content.push({ type: "text", text: cleanText });
  }
  for (const toolCall of toolCalls) {
    content.push(toolCall);
  }

  let stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";
  let stopSequence = null;

  if (stopReason === "end_turn" && Array.isArray(stopSequences) && cleanText) {
    for (const seq of stopSequences) {
      if (typeof seq === "string" && seq && cleanText.endsWith(seq)) {
        stopSequence = seq;
        stopReason = "stop_sequence";
        const trimmedText = cleanText.slice(0, -seq.length);
        const textBlock = content.find((b) => b.type === "text");
        if (textBlock) textBlock.text = trimmedText;
        break;
      }
    }
  }

  const usage = toUsage(workersAiResponse?.usage ?? workersAiResponse?.result?.usage);

  return {
    id: newMessageId(),
    type: "message",
    role: "assistant",
    model: requestedModel,
    content,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage,
  };
}

export function toUsage(usageMetadata) {
  const usage = usageMetadata ?? {};
  const prompt = usage.prompt_tokens ?? usage.promptTokenCount ?? 0;
  const completion = usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.completionTokenCount ?? 0;

  return {
    input_tokens: prompt,
    output_tokens: completion,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}
