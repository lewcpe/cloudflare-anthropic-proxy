import { describe, expect, it } from "vitest";
import { toAnthropicResponse, toUsage } from "../src/translate/response.js";

describe("response translator", () => {
  it("converts Workers AI object response to Anthropic message format", () => {
    const raw = {
      response: "Hello, world!",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const res = toAnthropicResponse(raw, "claude-sonnet-5");
    expect(res.type).toBe("message");
    expect(res.role).toBe("assistant");
    expect(res.model).toBe("claude-sonnet-5");
    expect(res.content).toEqual([{ type: "text", text: "Hello, world!" }]);
    expect(res.stop_reason).toBe("end_turn");
    expect(res.usage.input_tokens).toBe(10);
    expect(res.usage.output_tokens).toBe(5);
  });

  it("handles string response", () => {
    const res = toAnthropicResponse("Simple response text", "claude-sonnet-5");
    expect(res.content[0].text).toBe("Simple response text");
  });

  it("extracts tool calls and sets stop_reason to tool_use", () => {
    const raw = {
      choices: [
        {
          message: {
            content: "I will fetch the data.",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "web_fetch",
                  arguments: JSON.stringify({ url: "https://api.worldbank.org" }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 15 },
    };
    const res = toAnthropicResponse(raw, "claude-sonnet-5");
    expect(res.stop_reason).toBe("tool_use");
    expect(res.content).toHaveLength(2);
    expect(res.content[0]).toEqual({ type: "text", text: "I will fetch the data." });
    expect(res.content[1]).toEqual({
      type: "tool_use",
      id: "call_123",
      name: "web_fetch",
      input: { url: "https://api.worldbank.org" },
    });
  });

  it("parses text-embedded tool calls like [Tool Call: name(args)]", () => {
    const raw = {
      response:
        'Web search is returning empty results. Let me try fetching directly.\n[Tool Call: mcp__workspace__web_fetch({"url":"https://www.macrotrends.net/global-metrics/countries/THA/thailand/gdp-gross-domestic-product"})]',
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    };
    const res = toAnthropicResponse(raw, "claude-sonnet-5");
    expect(res.stop_reason).toBe("tool_use");
    expect(res.content).toHaveLength(2);
    expect(res.content[0]).toEqual({
      type: "text",
      text: "Web search is returning empty results. Let me try fetching directly.",
    });
    expect(res.content[1].type).toBe("tool_use");
    expect(res.content[1].name).toBe("mcp__workspace__web_fetch");
    expect(res.content[1].input).toEqual({
      url: "https://www.macrotrends.net/global-metrics/countries/THA/thailand/gdp-gross-domestic-product",
    });
  });
});
