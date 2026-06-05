export interface OnyxMarket {
  symbol: string;
  title: string;
  sport?: string;
  status?: string;
  [key: string]: unknown;
}

export interface OnyxPrice {
  symbol: string;
  bid_price: number | null;
  ask_price: number | null;
  last_price: number | null;
  yes_price?: number | null;
  volume?: number | null;
}

export interface OnyxClient {
  listMarkets(params?: Record<string, string>): Promise<OnyxMarket[]>;
  getPrice(symbol: string): Promise<OnyxPrice>;
}

// --- Real HTTP implementation (not called in tests) ---

interface WireMarket {
  symbol: string;
  name: string;
  sport?: string;
  status?: string;
  [key: string]: unknown;
}

export function httpOnyxClient(baseUrl: string): OnyxClient {
  return {
    async listMarkets(params) {
      const url = new URL("/markets", baseUrl);
      // Sensible defaults: only open markets, reasonable page size
      const merged: Record<string, string> = { status: "open", limit: "200", ...params };
      for (const [k, v] of Object.entries(merged)) {
        url.searchParams.set(k, v);
      }
      try {
        const res = await fetch(url.toString());
        if (!res.ok) {
          console.warn(`listMarkets failed: ${res.status} — returning empty list`);
          return [];
        }
        const wire = (await res.json()) as WireMarket[];
        return wire.map((m) => ({ ...m, title: m.name }));
      } catch (e) {
        console.warn("listMarkets network error — returning empty list:", (e as Error).message);
        return [];
      }
    },
    async getPrice(symbol) {
      const url = new URL(`/markets/${encodeURIComponent(symbol)}/prices`, baseUrl);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`getPrice(${symbol}) failed: ${res.status}`);
      return (await res.json()) as OnyxPrice;
    },
  };
}

// --- Mock implementation for tests ---

export interface MockFixtures {
  markets: OnyxMarket[];
  prices: Record<string, OnyxPrice | Error>;
}

export function mockOnyxClient(fixtures: MockFixtures): OnyxClient {
  return {
    async listMarkets() {
      return fixtures.markets;
    },
    async getPrice(symbol) {
      const entry = fixtures.prices[symbol];
      if (entry instanceof Error) throw entry;
      if (!entry) throw new Error(`No fixture for symbol ${symbol}`);
      return entry;
    },
  };
}
