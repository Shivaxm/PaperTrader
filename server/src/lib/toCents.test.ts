import { describe, it, expect } from "vitest";
import { toCents } from "./toCents.js";

describe("toCents", () => {
  it("0.5 → 50", () => expect(toCents(0.5)).toBe(50));
  it("0.01 → 1", () => expect(toCents(0.01)).toBe(1));
  it("0.99 → 99", () => expect(toCents(0.99)).toBe(99));
  it("0.005 → 1 (rounding)", () => expect(toCents(0.005)).toBe(1));
  it("null → null", () => expect(toCents(null)).toBeNull());
  it("NaN → null", () => expect(toCents(NaN)).toBeNull());
  it("undefined → null", () => expect(toCents(undefined)).toBeNull());
});
