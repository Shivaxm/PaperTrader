export const MIN_PRICE_CENTS = 1;
export const MAX_PRICE_CENTS = 99;

export type Side = "YES" | "NO";

export interface RawPrice {
  yesPriceCents: number | null;
  bidCents: number | null;
  lastCents: number | null;
  askCents: number | null;
}

export interface Resolved {
  cents: number;
  source: string;
}

function inBounds(v: number | null): v is number {
  return v !== null && v > MIN_PRICE_CENTS && v < MAX_PRICE_CENTS;
}

export function resolvePrice(raw: RawPrice, side: Side): Resolved | null {
  // Walk YES sources in priority order: last → yes → bid
  // askCents is never a source (advisory only)
  let yesCents: number | null = null;
  let ySource = "";

  if (inBounds(raw.lastCents)) {
    yesCents = raw.lastCents;
    ySource = "last";
  } else if (inBounds(raw.yesPriceCents)) {
    yesCents = raw.yesPriceCents;
    ySource = "yes";
  } else if (inBounds(raw.bidCents)) {
    yesCents = raw.bidCents;
    ySource = "bid";
  }

  if (yesCents === null) return null;

  if (side === "YES") {
    // Bounds guard on the YES value itself (already checked by inBounds, but be explicit)
    if (yesCents <= MIN_PRICE_CENTS || yesCents >= MAX_PRICE_CENTS) return null;
    return { cents: yesCents, source: ySource };
  }

  // side === "NO": candidate = 100 - YES price
  const noCents = 100 - yesCents;
  // Bounds guard on the post-inversion NO value
  if (noCents <= MIN_PRICE_CENTS || noCents >= MAX_PRICE_CENTS) return null;
  return { cents: noCents, source: "no:" + ySource };
}
