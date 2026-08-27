import { describe, expect, it } from "vitest";
import { fromBase64Url, newMessageId, newToolUseId, packToolUseId, toBase64Url, unpackToolUseId } from "../src/translate/ids.js";

describe("ids", () => {
  it("generates formatted message and tool ids", () => {
    expect(newMessageId()).toMatch(/^msg_[a-z0-9]{26}$/);
    expect(newToolUseId()).toMatch(/^toolu_[a-z0-9]{26}$/);
  });

  it("roundtrips base64url encoding", () => {
    const raw = "dGVzdCtoaQ==";
    const encoded = toBase64Url(raw);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(fromBase64Url(encoded)).toBe(raw);
  });

  it("packs and unpacks thought signatures", () => {
    const functionCall = { id: "toolu_123", name: "test" };
    const sig = "sig1234=";
    const packed = packToolUseId(functionCall, sig);
    expect(packed).toContain("__ts__");

    const unpacked = unpackToolUseId(packed);
    expect(unpacked.cleanId).toBe("toolu_123");
    expect(unpacked.signature).toBe(sig);
  });

  it("handles plain ids without signatures", () => {
    const unpacked = unpackToolUseId("toolu_123");
    expect(unpacked.cleanId).toBe("toolu_123");
    expect(unpacked.signature).toBeNull();
  });
});
