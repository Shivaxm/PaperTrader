import { useState } from "react";
import { useAuth } from "./lib/auth";
import * as api from "./lib/api";
import AuthPage from "./pages/AuthPage";
import MarketsView from "./pages/MarketsView";
import PortfolioView from "./pages/PortfolioView";
import HistoryView from "./pages/HistoryView";

type Tab = "markets" | "portfolio" | "history";

export default function App() {
  const { user, loading, setUser } = useAuth();
  const [tab, setTab] = useState<Tab>("markets");

  if (loading) {
    return (
      <div className="app-loading">
        <span className="app-loading-text">Loading...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-brand">ONYX PAPER</span>
        <div className="topbar-right">
          {user.balanceCents != null && (
            <span className="topbar-balance">
              {api.fmt(user.balanceCents)}
            </span>
          )}
          <span className="topbar-email">{user.email}</span>
          <button onClick={handleLogout} className="topbar-logout">
            Log out
          </button>
        </div>
      </header>
      <nav className="tab-bar">
        <button
          className={`tab${tab === "markets" ? " active" : ""}`}
          onClick={() => setTab("markets")}
        >
          Markets
        </button>
        <button
          className={`tab${tab === "portfolio" ? " active" : ""}`}
          onClick={() => setTab("portfolio")}
        >
          Portfolio
        </button>
        <button
          className={`tab${tab === "history" ? " active" : ""}`}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </nav>
      <main className="app-main">
        {tab === "markets" && <MarketsView />}
        {tab === "portfolio" && <PortfolioView />}
        {tab === "history" && <HistoryView />}
      </main>
    </div>
  );
}
