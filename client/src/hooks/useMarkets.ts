import { useState, useEffect } from "react";
import type { Market } from "../lib/api";
import * as api from "../lib/api";

const POLL_MS = 4000;
const DEBOUNCE_MS = 300;

function useDebouncedValue(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useMarkets(query: string) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  useEffect(() => {
    let cancelled = false;

    async function doFetch() {
      try {
        const params = debouncedQuery ? { q: debouncedQuery } : undefined;
        const res = await api.getMarkets(params);
        if (!cancelled) {
          res.markets.sort((a, b) => a.symbol.localeCompare(b.symbol));
          setMarkets(res.markets);
          setLastUpdated(new Date());
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch");
          setLoading(false);
        }
      }
    }

    void doFetch();
    const interval = setInterval(() => void doFetch(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [debouncedQuery]);

  return { markets, loading, error, lastUpdated };
}
