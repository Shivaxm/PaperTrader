export interface User {
  id: string;
  email: string;
  balanceCents?: number;
}

const BASE = import.meta.env.VITE_API_URL ?? "";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as Record<string, unknown>).error as string ?? `Request failed (${res.status})`
    );
  }

  return res.json() as Promise<T>;
}

export function signup(email: string, password: string): Promise<User> {
  return request("POST", "/auth/signup", { email, password });
}

export function login(email: string, password: string): Promise<User> {
  return request("POST", "/auth/login", { email, password });
}

export async function logout(): Promise<void> {
  await request("POST", "/auth/logout");
}

export function me(): Promise<User> {
  return request("GET", "/auth/me");
}

export function fmt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// --- Markets ---

export interface Market {
  symbol: string;
  title: string;
  priceCents: number | null;
  priceSource: string | null;
  state: "fresh" | "stale" | "unpriced";
  fetchedAt: string;
  tradeable: boolean;
}

export function getMarkets(params?: { q?: string }): Promise<{ markets: Market[] }> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  const query = qs.toString();
  return request("GET", `/markets${query ? `?${query}` : ""}`);
}

// --- Orders ---

export interface OrderResult {
  orderId: string;
  fillId: string;
  priceCents: number;
  priceSource: string;
  costCents: number;
}

export function placeOrder(
  symbol: string,
  side: "YES" | "NO",
  quantity: number,
  requestId: string
): Promise<OrderResult> {
  return request("POST", "/orders", { symbol, side, quantity, requestId });
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

// --- Order History ---

export interface Order {
  id: string;
  marketTitle: string;
  side: "YES" | "NO";
  quantity: number;
  priceCents: number | null;
  priceSource: string | null;
  costCents: number | null;
  createdAt: string;
}

export function getOrders(): Promise<{ orders: Order[] }> {
  return request("GET", "/orders");
}

// --- Portfolio ---

export interface Position {
  symbol: string;
  marketTitle: string;
  side: "YES" | "NO";
  quantity: number;
  avgCostCents: number;
  markCents: number;
  stale: boolean;
  costBasisCents: number;
  marketValueCents: number;
  unrealizedPnlCents: number;
}

export interface Portfolio {
  balanceCents: number;
  positions: Position[];
  totalPositionValueCents: number;
  totalUnrealizedPnlCents: number;
  equityCents: number;
}

export function getPortfolio(): Promise<Portfolio> {
  return request("GET", "/portfolio");
}
