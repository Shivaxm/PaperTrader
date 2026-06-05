import * as api from "../lib/api";
import { usePortfolio } from "../hooks/usePortfolio";
import TimeAgo from "../components/TimeAgo";

function pnlClass(cents: number): string {
  if (cents > 0) return "pnl-pos";
  if (cents < 0) return "pnl-neg";
  return "pnl-zero";
}

function pnlFmt(cents: number): string {
  if (cents > 0) return `+${api.fmt(cents)}`;
  return api.fmt(cents);
}

export default function PortfolioView() {
  const { portfolio, loading, error, lastUpdated } = usePortfolio();

  if (loading && !portfolio) {
    return <div className="markets-empty">Loading portfolio...</div>;
  }

  if (!portfolio) {
    return <div className="markets-empty">Failed to load portfolio.</div>;
  }

  return (
    <div className="portfolio-view">
      <div className="portfolio-header">
        <div className="portfolio-summary">
          <div className="summary-card">
            <span className="summary-label">Cash</span>
            <span className="summary-value">{api.fmt(portfolio.balanceCents)}</span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Position Value</span>
            <span className="summary-value">
              {api.fmt(portfolio.totalPositionValueCents)}
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Unrealized P&L</span>
            <span
              className={`summary-value ${pnlClass(portfolio.totalUnrealizedPnlCents)}`}
            >
              {pnlFmt(portfolio.totalUnrealizedPnlCents)}
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Equity</span>
            <span className="summary-value summary-equity">
              {api.fmt(portfolio.equityCents)}
            </span>
          </div>
        </div>
        <div className="markets-status">
          {error && <span className="markets-error-dot" title={error} />}
          {lastUpdated && (
            <span className="markets-updated">
              <TimeAgo date={lastUpdated} />
            </span>
          )}
        </div>
      </div>

      {portfolio.positions.length === 0 ? (
        <div className="markets-empty">
          No open positions yet — buy YES or NO on a market to get started.
        </div>
      ) : (
        <div className="positions-table">
          <div className="positions-thead">
            <span className="pos-col pos-market">Market</span>
            <span className="pos-col pos-side">Side</span>
            <span className="pos-col pos-qty">Qty</span>
            <span className="pos-col pos-avg">Avg Cost</span>
            <span className="pos-col pos-mark">Mark</span>
            <span className="pos-col pos-value">Mkt Value</span>
            <span className="pos-col pos-pnl">P&L</span>
          </div>
          <div className="positions-body">
            {portfolio.positions.map((pos) => (
              <div
                key={`${pos.symbol}-${pos.side}`}
                className={`positions-row${pos.stale ? " stale" : ""}`}
              >
                <span className="pos-col pos-market">
                  <span className="pos-market-title">{pos.marketTitle}</span>
                  {pos.stale && (
                    <span className="market-badge stale">stale price</span>
                  )}
                </span>
                <span className="pos-col pos-side">
                  <span
                    className={`side-badge ${pos.side.toLowerCase()}`}
                  >
                    {pos.side}
                  </span>
                </span>
                <span className="pos-col pos-qty">{pos.quantity}</span>
                <span className="pos-col pos-avg">{pos.avgCostCents}¢</span>
                <span className="pos-col pos-mark">{pos.markCents}¢</span>
                <span className="pos-col pos-value">
                  {api.fmt(pos.marketValueCents)}
                </span>
                <span className={`pos-col pos-pnl ${pnlClass(pos.unrealizedPnlCents)}`}>
                  {pnlFmt(pos.unrealizedPnlCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
