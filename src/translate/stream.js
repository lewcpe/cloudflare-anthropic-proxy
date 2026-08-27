import { newMessageId } from "./ids.js";
import { extractReasoningText, extractResponseText, toUsage } from "./response.js";

export async function* workersAiSseEvents(reader) {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) break;
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          yield JSON.parse(data);
        } catch {
          // In case raw text is streamed
          yield { response: data };
        }
      }
    }
    if (buffer.trim()) {
      const line = buffer.replace(/\r$/, "");
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data);
          } catch {
            yield { response: data };
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader lock might already be released
    }
  }
}

export function translateStream(upstreamStream, options = {}) {
  const { model: requestedModel, stopSequences = [], abortController = null } = options;
  const encoder = new TextEncoder();
  const messageId = newMessageId();
  const reader = upstreamStream.getReader ? upstreamStream.getReader() : null;

  let currentBlockIndex = -1;
  let openBlock = null;
  let hasToolUse = false;
  let started = false;
  let terminated = false;
  let usageMetadata = null;

  const format = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  return new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(format(event, data)));

      const sendStart = () => {
        if (started) return;
        started = true;
        send("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model: requestedModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { ...toUsage(usageMetadata), output_tokens: 0 },
          },
        });
      };

      const closeCurrentBlock = () => {
        if (!openBlock) return;
        send("content_block_stop", { type: "content_block_stop", index: currentBlockIndex });
        openBlock = null;
      };

      const openThinkingBlock = () => {
        if (openBlock?.type === "thinking") return;
        closeCurrentBlock();
        currentBlockIndex += 1;
        openBlock = { type: "thinking" };
        send("content_block_start", {
          type: "content_block_start",
          index: currentBlockIndex,
          content_block: { type: "thinking", thinking: "" },
        });
      };

      const openTextBlock = () => {
        if (openBlock?.type === "text") return;
        closeCurrentBlock();
        currentBlockIndex += 1;
        openBlock = { type: "text" };
        send("content_block_start", {
          type: "content_block_start",
          index: currentBlockIndex,
          content_block: { type: "text", text: "" },
        });
      };

      const openToolBlock = (id, name) => {
        closeCurrentBlock();
        currentBlockIndex += 1;
        hasToolUse = true;
        openBlock = { type: "tool_use" };
        send("content_block_start", {
          type: "content_block_start",
          index: currentBlockIndex,
          content_block: {
            type: "tool_use",
            id: id || newMessageId().replace("msg_", "toolu_"),
            name: name || "unknown_tool",
            input: {},
          },
        });
      };

      const sendEnd = () => {
        if (terminated) return;
        terminated = true;
        sendStart();

        closeCurrentBlock();

        if (currentBlockIndex < 0) {
          openTextBlock();
          closeCurrentBlock();
        }

        send("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: hasToolUse ? "tool_use" : "end_turn",
            stop_sequence: null,
          },
          usage: toUsage(usageMetadata),
        });
        send("message_stop", { type: "message_stop" });
      };

      const sendError = (err) => {
        if (terminated) return;
        terminated = true;
        sendStart();
        closeCurrentBlock();
        send("error", {
          type: "error",
          error: { type: "api_error", message: `stream interrupted: ${err?.message ?? err}` },
        });
      };

      try {
        if (!reader) throw new Error("upstream stream is unavailable");

        for await (const chunk of workersAiSseEvents(reader)) {
          if (chunk.error) {
            const errMsg = typeof chunk.error === "string" ? chunk.error : (chunk.error.message ?? JSON.stringify(chunk.error));
            throw new Error(errMsg);
          }
          if (chunk.usage) usageMetadata = chunk.usage;
          sendStart();

          const choices = Array.isArray(chunk.choices) ? chunk.choices : Array.isArray(chunk.result?.choices) ? chunk.result.choices : [];
          let handledTool = false;

          for (const choice of choices) {
            const deltaCalls = choice?.delta?.tool_calls || choice?.tool_calls;
            if (Array.isArray(deltaCalls)) {
              for (const call of deltaCalls) {
                if (call.function?.name || (call.id && openBlock?.type !== "tool_use")) {
                  openToolBlock(call.id, call.function?.name);
                }
                const partialArgs = call.function?.arguments;
                if (typeof partialArgs === "string" && partialArgs) {
                  if (openBlock?.type !== "tool_use") {
                    openToolBlock(call.id, call.function?.name);
                  }
                  send("content_block_delta", {
                    type: "content_block_delta",
                    index: currentBlockIndex,
                    delta: { type: "input_json_delta", partial_json: partialArgs },
                  });
                }
                handledTool = true;
              }
            }
          }

          if (!handledTool) {
            const reasoningDelta = extractReasoningText(chunk);
            const textDelta = extractResponseText(chunk);

            if (reasoningDelta) {
              openThinkingBlock();
              send("content_block_delta", {
                type: "content_block_delta",
                index: currentBlockIndex,
                delta: { type: "thinking_delta", thinking: reasoningDelta },
              });
            }

            if (textDelta) {
              openTextBlock();
              send("content_block_delta", {
                type: "content_block_delta",
                index: currentBlockIndex,
                delta: { type: "text_delta", text: textDelta },
              });
            }
          }
        }
        sendEnd();
      } catch (err) {
        sendError(err);
      } finally {
        try {
          controller.close();
        } catch {
          // standard stream close
        }
      }
    },

    cancel(reason) {
      abortController?.abort(reason);
      try {
        return reader?.cancel(reason).catch(() => {});
      } catch {
        return Promise.resolve();
      }
    },
  });
}
