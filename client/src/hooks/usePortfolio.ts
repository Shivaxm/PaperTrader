import { useState, useEffect } from "react";
import type { Portfolio } from "../lib/api";
import * as api from "../lib/api";

const POLL_MS = 4000;

export function usePortfolio() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function doFetch() {
      try {
        const res = await api.getPortfolio();
        if (!cancelled) {
          setPortfolio(res);
          setLastUpdated(new Date());
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          // Keep last good data; surface soft error
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
  }, []);

  return { portfolio, loading, error, lastUpdated };
}
