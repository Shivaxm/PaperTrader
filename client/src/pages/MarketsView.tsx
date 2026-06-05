import { useState } from "react";
import type { Market } from "../lib/api";
import { useMarkets } from "../hooks/useMarkets";
import OrderTicket from "../components/OrderTicket";
import TimeAgo from "../components/TimeAgo";

interface TicketState {
  symbol: string;
  title: string;
  side: "YES" | "NO";
  priceCents: number;
}

export default function MarketsView() {
  const [query, setQuery] = useState("");
  const { markets, loading, error, lastUpdated } = useMarkets(query);
  const [ticket, setTicket] = useState<TicketState | null>(null);

  function openTicket(market: Market, side: "YES" | "NO") {
    if (!market.tradeable || market.priceCents === null) return;
    const price = side === "YES" ? market.priceCents : 100 - market.priceCents;
    setTicket({
      symbol: market.symbol,
      title: market.title,
      side,
      priceCents: price,
    });
  }

  return (
    <div className="markets-view">
      <div className="markets-header">
        <input
          type="text"
          placeholder="Search markets..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="markets-search"
        />
        <div className="markets-status">
          {error && <span className="markets-error-dot" title={error} />}
          {lastUpdated && (
            <span className="markets-updated">
              <TimeAgo date={lastUpdated} />
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="markets-empty">Loading markets...</div>
      ) : markets.length === 0 ? (
        <div className="markets-empty">
          {query ? "No markets match your search." : "No markets available."}
        </div>
      ) : (
        <div className="markets-list">
          {markets.map((m) => (
            <div
              key={m.symbol}
              className={`market-row${m.state !== "fresh" ? ` ${m.state}` : ""}`}
            >
              <div className="market-info">
                <span className="market-title">{m.title}</span>
                {m.state === "stale" && (
                  <span className="market-badge stale">stale</span>
                )}
                {m.state === "unpriced" && (
                  <span className="market-badge unpriced">no live price</span>
                )}
              </div>
              <div className="market-chips">
                <button
                  className="price-chip yes"
                  disabled={!m.tradeable}
                  onClick={() => openTicket(m, "YES")}
                >
                  Yes {m.priceCents !== null ? `${m.priceCents}¢` : "\u2014"}
                </button>
                <button
                  className="price-chip no"
                  disabled={!m.tradeable}
                  onClick={() => openTicket(m, "NO")}
                >
                  No{" "}
                  {m.priceCents !== null
                    ? `${100 - m.priceCents}¢`
                    : "\u2014"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {ticket && (
        <OrderTicket
          symbol={ticket.symbol}
          title={ticket.title}
          side={ticket.side}
          priceCents={ticket.priceCents}
          onClose={() => setTicket(null)}
        />
      )}
    </div>
  );
}
