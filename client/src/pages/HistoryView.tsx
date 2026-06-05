import { useState, useEffect } from "react";
import type { Order } from "../lib/api";
import * as api from "../lib/api";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function HistoryView() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.getOrders();
        if (!cancelled) {
          setOrders(res.orders);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch");
          setOrders([]);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  if (orders === null) {
    return <div className="markets-empty">Loading orders...</div>;
  }

  return (
    <div className="history-view">
      {error && (
        <div className="history-error">
          Failed to load order history.
        </div>
      )}
      {orders.length === 0 && !error ? (
        <div className="markets-empty">
          No orders yet — head to Markets to place your first trade.
        </div>
      ) : orders.length > 0 ? (
        <div className="history-table">
          <div className="history-thead">
            <span className="hist-col hist-date">Date</span>
            <span className="hist-col hist-market">Market</span>
            <span className="hist-col hist-side">Side</span>
            <span className="hist-col hist-qty">Qty</span>
            <span className="hist-col hist-price">Fill Price</span>
            <span className="hist-col hist-cost">Cost</span>
          </div>
          <div className="history-body">
            {orders.map((o) => (
              <div key={o.id} className="history-row">
                <span className="hist-col hist-date">{formatDate(o.createdAt)}</span>
                <span className="hist-col hist-market">
                  <span className="hist-market-title">{o.marketTitle}</span>
                  {o.priceSource && (
                    <span className="hist-source">{o.priceSource}</span>
                  )}
                </span>
                <span className="hist-col hist-side">
                  <span className={`side-badge ${o.side.toLowerCase()}`}>
                    {o.side}
                  </span>
                </span>
                <span className="hist-col hist-qty">{o.quantity}</span>
                <span className="hist-col hist-price">
                  {o.priceCents !== null ? `${o.priceCents}¢` : "—"}
                </span>
                <span className="hist-col hist-cost">
                  {o.costCents !== null ? api.fmt(o.costCents) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
