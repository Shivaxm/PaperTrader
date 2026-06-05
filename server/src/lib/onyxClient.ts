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

export function httpOnyxClient(baseUrl: string): OnyxClient {
  return {
    async listMarkets(params) {
      const url = new URL("/markets", baseUrl);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          url.searchParams.set(k, v);
        }
      }
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`listMarkets failed: ${res.status}`);
      return (await res.json()) as OnyxMarket[];
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
