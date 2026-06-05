import { useState, useRef } from "react";
import * as api from "../lib/api";
import { useAuth } from "../lib/auth";

interface OrderTicketProps {
  symbol: string;
  title: string;
  side: "YES" | "NO";
  priceCents: number;
  onClose: () => void;
}

export default function OrderTicket({
  symbol,
  title,
  side,
  priceCents,
  onClose,
}: OrderTicketProps) {
  const { refresh } = useAuth();
  const [quantity, setQuantity] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{
    priceCents: number;
    costCents: number;
  } | null>(null);

  // One requestId per ticket-open — reused across retries so backend
  // idempotency collapses double-clicks into a single fill.
  const requestIdRef = useRef(api.newRequestId());

  const costCents = priceCents * quantity;

  async function handleBuy() {
    setError("");
    setBusy(true);
    try {
      const result = await api.placeOrder(
        symbol,
        side,
        quantity,
        requestIdRef.current
      );
      setSuccess({ priceCents: result.priceCents, costCents: result.costCents });
      await refresh();
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ticket-overlay" onClick={onClose}>
      <div className="ticket-card" onClick={(e) => e.stopPropagation()}>
        <div className="ticket-header">
          <span className="ticket-title">{title}</span>
          <button className="ticket-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={`ticket-side ${side.toLowerCase()}`}>
          Buy {side} @ {priceCents}¢
        </div>

        <label className="ticket-label">
          Quantity
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (v > 0) setQuantity(v);
            }}
            className="ticket-input"
          />
        </label>

        <div className="ticket-cost">
          Est. cost:{" "}
          <span className="ticket-cost-value">{api.fmt(costCents)}</span>
        </div>

        {error && <p className="ticket-error">{error}</p>}
        {success && (
          <p className="ticket-success">
            Filled at {success.priceCents}¢ — cost{" "}
            {api.fmt(success.costCents)}
          </p>
        )}

        <button
          className={`ticket-buy ${side.toLowerCase()}`}
          disabled={busy || !!success}
          onClick={handleBuy}
        >
          {busy ? "Placing..." : success ? "Filled" : `Buy ${side}`}
        </button>
      </div>
    </div>
  );
}
