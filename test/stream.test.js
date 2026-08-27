import { describe, expect, it } from "vitest";
import { translateStream, workersAiSseEvents } from "../src/translate/stream.js";

describe("stream translator", () => {
  it("parses SSE lines correctly", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"response": "Hello"}\n\n'));
        controller.enqueue(encoder.encode('data: {"response": " world"}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const reader = stream.getReader();
    const events = [];
    for await (const evt of workersAiSseEvents(reader)) {
      events.push(evt);
    }
    expect(events).toHaveLength(2);
    expect(events[0].response).toBe("Hello");
    expect(events[1].response).toBe(" world");
  });

  it("translates Workers AI SSE stream into Anthropic SSE stream", async () => {
    const encoder = new TextEncoder();
    const upstreamStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"response": "Hello"}\n\n'));
        controller.enqueue(encoder.encode('data: {"response": " world!"}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const anthropicStream = translateStream(upstreamStream, { model: "claude-sonnet-5" });
    const reader = anthropicStream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: content_block_stop");
    expect(text).toContain("event: message_delta");
    expect(text).toContain("event: message_stop");
    expect(text).toContain('"text":"Hello"');
    expect(text).toContain('"text":" world!"');
  });

  it("streams tool calls correctly", async () => {
    const encoder = new TextEncoder();
    const upstreamStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_abc",
                        function: { name: "get_weather", arguments: '{"loc' },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        function: { arguments: 'ation":"Bangkok"}' },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const anthropicStream = translateStream(upstreamStream, { model: "claude-sonnet-5" });
    const reader = anthropicStream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(text).toContain('"type":"tool_use"');
    expect(text).toContain('"name":"get_weather"');
    expect(text).toContain('"input_json_delta"');
    expect(text).toContain('"stop_reason":"tool_use"');
  });
});
