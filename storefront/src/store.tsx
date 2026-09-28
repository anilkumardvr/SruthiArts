import * as React from "react";

import { type Buyer, type Painting, type Shop, cartOn as cartOnFor, emptyBuyer, fetchStock, isAuction, makeMoney, mergeStock, stockOf } from "@/lib/shop";

// The cart lives in this browser only (localStorage). Prices, stock and delivery fees are checked again by the
// checkout server, so nothing here decides what a buyer pays.
const CART_KEY = "sruthiarts.cart";
type CartItem = { id: string; qty: number };
export type CartLine = CartItem & { p: Painting };
export type CartStep = "cart" | "details" | "pay" | "done";

function loadCart(): CartItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]") || [];
    return (Array.isArray(raw) ? raw : []).filter((c) => c && typeof c.id === "string" && Number(c.qty) > 0).map((c) => ({ id: c.id, qty: Number(c.qty) }));
  } catch {
    return [];
  }
}

type Store = {
  shop: Shop;
  money: (n: number) => string;
  currency: string;
  cartEnabled: boolean;
  setPaintings: (fn: (ps: Painting[]) => Painting[]) => void;
  // viewer
  current: number;
  openPiece: (idx: number) => void;
  closePiece: () => void;
  // cart
  lines: CartLine[];
  count: number;
  subtotal: number;
  inCart: (id: string) => number;
  addToCart: (p: Painting, qty: number) => number;
  setQty: (id: string, qty: number) => void;
  removeLine: (id: string) => void;
  clearCart: () => void;
  bump: number;
  cartOpen: boolean;
  cartStep: CartStep;
  cartNotes: string[];
  openCart: (step?: CartStep) => void;
  closeCart: () => void;
  setCartStep: (s: CartStep) => void;
  buyer: Buyer;
  setBuyer: React.Dispatch<React.SetStateAction<Buyer>>;
  applyStock: (stock?: { id: string; left: number }[]) => void;
};

const StoreContext = React.createContext<Store | null>(null);
export const useStore = () => {
  const s = React.useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
};

export function StoreProvider({ initial, children }: { initial: Shop; children: React.ReactNode }) {
  const [shop, setShop] = React.useState(initial);
  // Latest paintings, updated synchronously so the cart can reconcile right after a live stock refresh.
  const paintingsRef = React.useRef(initial.paintings);
  const [cart, setCartState] = React.useState<CartItem[]>(loadCart);
  // Every change goes through here so handlers that run back to back (Buy now = add, then open) see the latest cart.
  const cartRef = React.useRef(cart);
  const setCart = React.useCallback((next: CartItem[] | ((cs: CartItem[]) => CartItem[])) => {
    cartRef.current = typeof next === "function" ? next(cartRef.current) : next;
    setCartState(cartRef.current);
  }, []);
  const [current, setCurrent] = React.useState(-1);
  const [bump, setBump] = React.useState(0);
  const [cartOpen, setCartOpen] = React.useState(false);
  const [cartStep, setCartStep] = React.useState<CartStep>("cart");
  const [cartNotes, setCartNotes] = React.useState<string[]>([]);
  const [buyer, setBuyer] = React.useState<Buyer>(emptyBuyer);

  const currency = shop.artist.currency || "CAD";
  const money = React.useMemo(() => makeMoney(currency), [currency]);
  const cartEnabled = cartOnFor(shop.artist);

  React.useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart.filter((c) => c.qty > 0).map(({ id, qty }) => ({ id, qty })))); } catch { /* private mode */ }
  }, [cart]);

  const find = React.useCallback((id: string) => shop.paintings.find((p) => p.id === id), [shop.paintings]);
  const lines = React.useMemo(() => cart.map((c) => ({ ...c, p: find(c.id) })).filter((c): c is CartLine => Boolean(c.p)), [cart, find]);
  const count = lines.reduce((t, c) => t + c.qty, 0);
  const subtotal = lines.reduce((t, c) => t + Number(c.p.price) * c.qty, 0);
  const inCart = React.useCallback((id: string) => cartRef.current.find((c) => c.id === id)?.qty || 0, [cart]); // re-created when the cart changes so readers re-render

  // Returns how many were actually added (stock may cap it).
  const addToCart = React.useCallback((p: Painting, qty: number) => {
    if (isAuction(p)) return 0; // bids only
    const left = Math.min(stockOf(p), 20);
    const before = cartRef.current.find((c) => c.id === p.id)?.qty || 0;
    const after = Math.min(left, before + qty);
    setCart((cs) => (cs.some((c) => c.id === p.id) ? cs.map((c) => (c.id === p.id ? { ...c, qty: after } : c)) : after > 0 ? [...cs, { id: p.id, qty: after }] : cs));
    setBump((b) => b + 1);
    return after - before;
  }, [setCart]);

  const setQty = React.useCallback((id: string, qty: number) => setCart((cs) => cs.map((c) => (c.id === id ? { ...c, qty } : c))), [setCart]);
  const removeLine = React.useCallback((id: string) => setCart((cs) => cs.filter((c) => c.id !== id)), [setCart]);
  const clearCart = React.useCallback(() => setCart([]), [setCart]);

  // Keep the cart honest after the shop data loads: drop sold-out pieces, cap quantities at what's left.
  const reconcile = React.useCallback((ps: Painting[], cs: CartItem[]) => {
    const notes: string[] = [];
    const next = cs.flatMap((c) => {
      const p = ps.find((x) => x.id === c.id);
      if (!p) return [];
      if (isAuction(p)) { notes.push(`“${p.title}” is now being auctioned, so it was removed. You can bid on it above the shop.`); return []; }
      const left = stockOf(p);
      if (left === 0) { notes.push(`“${p.title}” has sold out and was removed.`); return []; }
      if (c.qty > left) { notes.push(`Only ${left} of “${p.title}” left, so your cart was updated.`); return [{ ...c, qty: left }]; }
      return [c];
    });
    return { next, notes };
  }, []);

  const closePiece = React.useCallback(() => setCurrent(-1), []);

  // Bumped on every open and close, so a late stock answer only touches the cart session that asked for it.
  const cartSeq = React.useRef(0);
  const openPiece = React.useCallback((idx: number) => { cartSeq.current++; setCartOpen(false); setCurrent(idx); }, []);
  const closeCart = React.useCallback(() => {
    cartSeq.current++;
    setCartOpen(false);
    // After an order the panel starts fresh next time.
    setCartStep((s) => (s === "done" ? "cart" : s));
    setCartNotes([]);
  }, []);

  const setPaintings = React.useCallback((fn: (ps: Painting[]) => Painting[]) => {
    const ps = fn(paintingsRef.current);
    if (ps === paintingsRef.current) return;
    paintingsRef.current = ps;
    setShop((s) => ({ ...s, paintings: ps }));
  }, []);

  // Live stock: once after load, whenever the tab comes back into view, and before the cart opens.
  // The cart is reconciled after the first refresh (against shop.json if the server can't be reached), never
  // against shop.json alone first, which could drop pieces that are back in stock since the last deploy.
  const artist = shop.artist;
  const refreshStock = React.useCallback(async () => {
    const live = await fetchStock(artist);
    if (live) setPaintings((ps) => mergeStock(ps, live));
    return paintingsRef.current;
  }, [artist, setPaintings]);

  React.useEffect(() => {
    refreshStock().then((ps) => setCart((cs) => reconcile(ps, cs).next));
    const onVisible = () => { if (document.visibilityState === "visible") refreshStock(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshStock, reconcile, setCart]);

  // Opens straight away with the stock already on the page, then checks live stock in the background and
  // reconciles again, adding any notes, if this same cart session is still open when the answer arrives.
  const openCart = React.useCallback((step: CartStep = "cart") => {
    if (!cartEnabled) return;
    const seq = ++cartSeq.current;
    const { next, notes } = reconcile(paintingsRef.current, cartRef.current);
    setCart(next);
    setCartNotes(notes);
    setCartStep(next.length ? step : "cart");
    setCurrent(-1);
    setCartOpen(true);
    refreshStock().then((ps) => {
      if (cartSeq.current !== seq) return; // closed or reopened since
      const later = reconcile(ps, cartRef.current);
      if (!later.notes.length) return;
      setCart(later.next);
      setCartNotes((ns) => [...ns, ...later.notes.filter((n) => !ns.includes(n))]);
      if (!later.next.length) setCartStep((s) => (s === "done" ? s : "cart"));
    });
  }, [cartEnabled, refreshStock, reconcile, setCart]);

  // Show the new stock straight away; the site itself refreshes about a minute later.
  const applyStock = React.useCallback((stock?: { id: string; left: number }[]) => {
    if (!stock || !stock.length) return;
    setPaintings((ps) => ps.map((p) => {
      const s = stock.find((x) => x.id === p.id);
      return s && typeof s.left === "number" ? { ...p, quantity: s.left, status: s.left > 0 ? "available" : "sold" } : p;
    }));
  }, [setPaintings]);

  const value: Store = {
    shop, money, currency, cartEnabled, setPaintings,
    current, openPiece, closePiece,
    lines, count, subtotal, inCart, addToCart, setQty, removeLine, clearCart, bump,
    cartOpen, cartStep, cartNotes, openCart, closeCart, setCartStep,
    buyer, setBuyer, applyStock,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
