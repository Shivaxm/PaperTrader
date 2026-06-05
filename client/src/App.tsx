import { useAuth } from "./lib/auth";
import * as api from "./lib/api";
import AuthPage from "./pages/AuthPage";
import MarketsView from "./pages/MarketsView";

export default function App() {
  const { user, loading, setUser } = useAuth();

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
        <button className="tab active">Markets</button>
        <button className="tab" disabled>
          Portfolio
        </button>
        <button className="tab" disabled>
          History
        </button>
      </nav>
      <main className="app-main">
        <MarketsView />
      </main>
    </div>
  );
}
