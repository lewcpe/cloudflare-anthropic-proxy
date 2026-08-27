import { describe, expect, it } from "vitest";
import { toSystemText, toTools, toWorkersAiMessages, toWorkersAiRequest } from "../src/translate/request.js";

describe("request translator", () => {
  it("translates system text correctly", () => {
    expect(toSystemText("You are helpful")).toBe("You are helpful");
    expect(
      toSystemText([
        { type: "text", text: "Line 1" },
        { type: "text", text: "Line 2" },
      ]),
    ).toBe("Line 1\nLine 2");
  });

  it("prepends system message to messages list", () => {
    const messages = toWorkersAiMessages([{ role: "user", content: "hello" }], "Be concise");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: "Be concise" });
    expect(messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("translates full request body to Workers AI format", () => {
    const body = {
      model: "claude-sonnet-5",
      max_tokens: 100,
      temperature: 0.7,
      system: "System prompt",
      messages: [{ role: "user", content: "Hi there" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather for location",
          input_schema: {
            type: "object",
            properties: { location: { type: "string" } },
          },
        },
      ],
    };
    const req = toWorkersAiRequest(body);
    expect(req.messages).toHaveLength(2);
    expect(req.max_tokens).toBe(100);
    expect(req.temperature).toBe(0.7);
    expect(req.tools).toHaveLength(1);
    expect(req.tools[0].function.name).toBe("get_weather");
  });
});
