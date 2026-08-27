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

export function toAnthropicResponse(workersAiResponse, requestedModel, stopSequences) {
  const reasoning = extractReasoningText(workersAiResponse);
  const text = extractResponseText(workersAiResponse);
  const toolCalls = extractToolCalls(workersAiResponse);
  const content = [];

  if (reasoning) {
    content.push({ type: "thinking", thinking: reasoning });
  }
  if (text) {
    content.push({ type: "text", text });
  }
  for (const toolCall of toolCalls) {
    content.push(toolCall);
  }

  let stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";
  let stopSequence = null;

  if (stopReason === "end_turn" && Array.isArray(stopSequences) && text) {
    for (const seq of stopSequences) {
      if (typeof seq === "string" && seq && text.endsWith(seq)) {
        stopSequence = seq;
        stopReason = "stop_sequence";
        const trimmedText = text.slice(0, -seq.length);
        if (content[0]) content[0].text = trimmedText;
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
