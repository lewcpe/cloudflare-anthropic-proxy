import { describe, expect, it } from "vitest";
import { isEmptyObjectSchema, sanitizeSchema } from "../src/translate/schema.js";

describe("schema sanitizer", () => {
  it("strips unsupported schema keys", () => {
    const input = {
      type: "object",
      title: "My Schema",
      $schema: "http://json-schema.org/draft-07/schema#",
      minimum: 5,
      properties: {
        foo: { type: "string", minLength: 2 },
      },
    };
    const sanitized = sanitizeSchema(input);
    expect(sanitized.title).toBeUndefined();
    expect(sanitized.$schema).toBeUndefined();
    expect(sanitized.minimum).toBeUndefined();
    expect(sanitized.properties.foo.minLength).toBeUndefined();
    expect(sanitized.properties.foo.type).toBe("string");
  });

  it("detects empty object schema", () => {
    expect(isEmptyObjectSchema({ type: "object" })).toBe(true);
    expect(isEmptyObjectSchema({ type: "object", properties: {} })).toBe(true);
    expect(isEmptyObjectSchema({ type: "object", properties: { a: { type: "string" } } })).toBe(false);
  });

  it("inlines $ref", () => {
    const root = {
      $defs: {
        Address: { type: "object", properties: { city: { type: "string" } } },
      },
      type: "object",
      properties: {
        addr: { $ref: "#/$defs/Address" },
      },
    };
    const sanitized = sanitizeSchema(root);
    expect(sanitized.properties.addr.type).toBe("object");
    expect(sanitized.properties.addr.properties.city.type).toBe("string");
  });
});
