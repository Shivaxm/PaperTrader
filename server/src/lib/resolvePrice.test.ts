import { describe, it, expect } from "vitest";
import { resolvePrice, type RawPrice } from "./resolvePrice.js";

describe("resolvePrice", () => {
  // Case 1: YES with all sources present → uses last, source "last"
  it("YES with all sources present uses last", () => {
    const raw: RawPrice = { lastCents: 50, yesPriceCents: 40, bidCents: 30, askCents: 60 };
    const result = resolvePrice(raw, "YES");
    expect(result).toEqual({ cents: 50, source: "last" });
  });

  // Case 2: YES with last null → falls back to yes; with last and yes null → falls back to bid
  it("YES falls back to yes when last is null", () => {
    const raw: RawPrice = { lastCents: null, yesPriceCents: 40, bidCents: 30, askCents: 60 };
    const result = resolvePrice(raw, "YES");
    expect(result).toEqual({ cents: 40, source: "yes" });
  });

  it("YES falls back to bid when last and yes are null", () => {
    const raw: RawPrice = { lastCents: null, yesPriceCents: null, bidCents: 30, askCents: 60 };
    const result = resolvePrice(raw, "YES");
    expect(result).toEqual({ cents: 30, source: "bid" });
  });

  // Case 3: Crossed ask — ask is ignored entirely
  it("crossed ask: bid=50 ask=5 last=50 → YES resolves to 50 (ask ignored)", () => {
    const raw: RawPrice = { lastCents: 50, yesPriceCents: null, bidCents: 50, askCents: 5 };
    const result = resolvePrice(raw, "YES");
    expect(result).toEqual({ cents: 50, source: "last" });
  });

  // Case 4: NO side: YES price 30 → NO returns 70, source "no:last"
  it("NO side inverts YES price", () => {
    const raw: RawPrice = { lastCents: 30, yesPriceCents: null, bidCents: null, askCents: null };
    const result = resolvePrice(raw, "NO");
    expect(result).toEqual({ cents: 70, source: "no:last" });
  });

  // Case 5: OOB guard — source value of 0 or 100 is skipped
  it("OOB source values are skipped, falls through", () => {
    const raw: RawPrice = { lastCents: 0, yesPriceCents: 100, bidCents: 50, askCents: null };
    const result = resolvePrice(raw, "YES");
    expect(result).toEqual({ cents: 50, source: "bid" });
  });

  it("all sources OOB → returns null", () => {
    const raw: RawPrice = { lastCents: 0, yesPriceCents: 100, bidCents: 1, askCents: 50 };
    const result = resolvePrice(raw, "YES");
    expect(result).toBeNull();
  });

  // Case 6: Post-inversion NO guard — YES=99 → NO=1, 1 is not > MIN, returns null
  it("post-inversion NO guard: YES=99 is OOB so skipped; YES=98 → NO=2 ok", () => {
    // YES price 99 is OOB (not strictly < MAX=99), so it's skipped entirely
    const raw: RawPrice = { lastCents: 99, yesPriceCents: null, bidCents: null, askCents: null };
    expect(resolvePrice(raw, "NO")).toBeNull();
  });

  it("post-inversion NO guard: YES resolves to 98 → NO=2 which is > MIN, ok", () => {
    const raw: RawPrice = { lastCents: 98, yesPriceCents: null, bidCents: null, askCents: null };
    expect(resolvePrice(raw, "NO")).toEqual({ cents: 2, source: "no:last" });
  });

  it("post-inversion NO guard: YES=2 → NO=98 which is < MAX, ok", () => {
    const raw: RawPrice = { lastCents: 2, yesPriceCents: null, bidCents: null, askCents: null };
    expect(resolvePrice(raw, "NO")).toEqual({ cents: 98, source: "no:last" });
  });

  // The key test: YES resolves but the NO inversion lands on boundary
  it("post-inversion NO guard: last=null, yes=null, bid=98 → NO=2 is valid", () => {
    const raw: RawPrice = { lastCents: null, yesPriceCents: null, bidCents: 98, askCents: null };
    expect(resolvePrice(raw, "NO")).toEqual({ cents: 2, source: "no:bid" });
  });

  it("post-inversion NO guard: bid=2 → NO=98 valid", () => {
    const raw: RawPrice = { lastCents: null, yesPriceCents: null, bidCents: 2, askCents: null };
    expect(resolvePrice(raw, "NO")).toEqual({ cents: 98, source: "no:bid" });
  });

  // Case 7: All sources null → null
  it("all sources null → null", () => {
    const raw: RawPrice = { lastCents: null, yesPriceCents: null, bidCents: null, askCents: null };
    expect(resolvePrice(raw, "YES")).toBeNull();
    expect(resolvePrice(raw, "NO")).toBeNull();
  });
});
