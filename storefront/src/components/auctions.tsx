import * as React from "react";
import { Gavel, Clock, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { FadeImage } from "@/components/fade-image";
import {
  type AuctionState, type Bidder, type Painting, ApiError, api, getJson, isAuction, loadBidder, postAuth, postJson, reduceMotion, saveBidder, spec, validCheckoutApi,
} from "@/lib/shop";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/hooks/use-media-query";
import { useStore } from "@/store";

const POLL_MS = 5000;
const SHOW_CLOSED_MS = 7 * 24 * 3600 * 1000; // ended auctions stay visible (as Sold / Ended) for a week

// Ticks every second, corrected for the difference between this device's clock and the server's.
function useNow(skew: number) {
  const [now, setNow] = React.useState(() => Date.now() + skew);
  React.useEffect(() => {
    setNow(Date.now() + skew);
    const t = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(t);
  }, [skew]);
  return now;
}

function countdown(ms: number) {
  if (ms <= 0) return "Closing…";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, "0")}s`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
};

function StatusBadge({ st, now }: { st: AuctionState; now: number }) {
  if (st.status === "won") return <Badge className="bg-plum text-white">Sold at auction</Badge>;
  if (st.status === "ended") return <Badge variant="muted">Ended</Badge>;
  const left = Date.parse(st.endsAt) - now;
  return (
    <Badge variant={left < 120000 ? "destructive" : "success"} className="gap-1.5">
      <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-current" /></span>
      Live
    </Badge>
  );
}

// ---------- Bid dialog ----------
function BidPanel({ p, st, now, onState }: { p: Painting; st: AuctionState; now: number; onState: (s: AuctionState) => void }) {
  const { shop, money } = useStore();
  const a = shop.artist;
  const [bidder, setBidder] = React.useState<Bidder | null>(loadBidder);
  const [step, setStep] = React.useState<"who" | "code">("who");
  const [name, setName] = React.useState(bidder?.name || "");
  const [email, setEmail] = React.useState(bidder?.email || "");
  const [code, setCode] = React.useState("");
  const [amount, setAmount] = React.useState(String(st.minNext));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; kind: "ok" | "err" | "info" } | null>(null);
  const amountRef = React.useRef<HTMLInputElement>(null);
  const live = st.status === "live" && Date.parse(st.endsAt) > now;

  // Someone else bid: move the suggested amount up, unless the visitor is typing their own.
  React.useEffect(() => {
    if (document.activeElement !== amountRef.current && !(Number(amount) >= st.minNext)) setAmount(String(st.minNext));
  }, [st.minNext]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ text: (e as Error).message, kind: "err" }); } finally { setBusy(false); }
  };
  const start = () => run(async () => {
    if (name.trim().length < 2) throw new Error("Please enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) throw new Error("Please enter a valid email address.");
    await postJson(api(a, "/api/bidders/start"), { name: name.trim(), email: email.trim() });
    setStep("code"); setCode("");
    setMsg({ text: `We emailed a 6-digit code to ${email.trim()}. It expires in 10 minutes.`, kind: "info" });
  });
  const verify = () => run(async () => {
    const b = await postJson<Bidder>(api(a, "/api/bidders/verify"), { email: email.trim(), code });
    saveBidder(b); setBidder(b); setStep("who");
    setMsg({ text: `You're verified, ${b.name}. You can bid now.`, kind: "ok" });
  });
  const bid = () => run(async () => {
    if (!bidder) return;
    const n = Number(amount);
    if (!(n >= st.minNext)) throw new Error(`The minimum bid is ${money(st.minNext)}.`);
    try {
      const r = await postAuth<{ state: AuctionState; extended: boolean }>(api(a, `/api/auctions/${p.id}/bid`), { amount: Math.round(n * 100) / 100 }, bidder.token);
      onState(r.state);
      setMsg({ text: `You're the highest bidder at ${money(n)}.${r.extended ? " A late bid adds 2 minutes, so the auction was extended." : ""}`, kind: "ok" });
    } catch (e) {
      const data = e instanceof ApiError ? e.data : {};
      if (data.state) onState(data.state as AuctionState);
      if (data.code === "bidder_needed") { saveBidder(null); setBidder(null); throw new Error("Please confirm your email again to bid."); }
      if (data.code === "too_low" && typeof data.min === "number") { setAmount(String(data.min)); throw new Error(`Someone just bid. The minimum is now ${money(data.min)}.`); }
      throw e;
    }
  });

  const note = msg && (
    <p role={msg.kind === "err" ? "alert" : "status"} className={cn("rounded-xl px-3.5 py-2.5 text-sm", msg.kind === "err" ? "bg-destructive/5 text-destructive" : msg.kind === "ok" ? "bg-success/10 text-success" : "bg-secondary text-secondary-foreground")}>
      {msg.kind === "ok" && <Check className="mr-1 inline size-4 align-[-3px]" />}{msg.text}
    </p>
  );

  if (!live) {
    return (
      <div className="bg-muted/60 rounded-2xl p-4 text-sm">
        {st.status === "won" ? <p>Sold at auction for <b>{money(st.high || 0)}</b>. Thank you to everyone who bid!</p>
          : st.status === "ended" ? <p>{st.count ? "This auction ended without reaching its reserve." : "This auction ended with no bids."} Follow Sruthi for the next one.</p>
          : <p>Bidding has closed. The result appears here in a moment.</p>}
      </div>
    );
  }
  if (!bidder) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">To bid, confirm your email once. We send you a code, and you're set for 30 days on this device.</p>
        {step === "who" ? (
          <form noValidate className="grid gap-3" onSubmit={(e) => { e.preventDefault(); start(); }}>
            <div className="grid gap-1.5"><Label htmlFor="b-name">Your name</Label><Input id="b-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /><small className="text-muted-foreground text-xs">Others see only the first two letters, like “{(name.trim() || "Priya").slice(0, 2)}***”.</small></div>
            <div className="grid gap-1.5"><Label htmlFor="b-email">Email</Label><Input id="b-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {note}
            <Button type="submit" size="lg" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</Button>
          </form>
        ) : (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            {note}
            <div className="grid gap-1.5"><Label htmlFor="b-code">6-digit code</Label><Input id="b-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center font-mono text-xl tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus /></div>
            <Button type="submit" size="lg" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Confirm"}</Button>
            <Button type="button" variant="link" size="sm" onClick={() => { setStep("who"); setMsg(null); }}>Use a different email or send a new code</Button>
          </form>
        )}
      </div>
    );
  }
  return (
    <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); bid(); }}>
      <div className="grid gap-1.5">
        <Label htmlFor="b-amount">Your bid ({shop.artist.currency || "CAD"})</Label>
        <div className="flex gap-2">
          <Input ref={amountRef} id="b-amount" type="number" inputMode="decimal" min={st.minNext} step={st.increment} value={amount} onChange={(e) => setAmount(e.target.value)} className="text-lg" />
          <Button type="submit" size="lg" disabled={busy} className="shrink-0"><Gavel /> {busy ? "Bidding…" : "Place bid"}</Button>
        </div>
        <small className="text-muted-foreground text-xs">Minimum {money(st.minNext)} · bids go up by at least {money(st.increment)}</small>
      </div>
      {note}
      <p className="text-muted-foreground text-xs">
        Bidding as <b className="text-foreground">{bidder.name}</b> ({bidder.email}).{" "}
        <button type="button" className="text-primary underline underline-offset-4" onClick={() => { saveBidder(null); setBidder(null); setMsg(null); }}>Not you?</button>
      </p>
      <p className="text-muted-foreground text-xs leading-relaxed">Bids can't be taken back. A bid in the last 2 minutes adds 2 minutes. If you win, you get an email with a link to pay within 48 hours; delivery is added when you pay.</p>
    </form>
  );
}

function BidDialog({ p, st, now, open, onOpenChange, onState }: { p?: Painting; st?: AuctionState; now: number; open: boolean; onOpenChange: (o: boolean) => void; onState: (s: AuctionState) => void }) {
  const { money } = useStore();
  const isPhone = useIsPhone();
  if (!p || !st) return null;
  const Title = isPhone ? DrawerTitle : DialogTitle;
  const Desc = isPhone ? DrawerDescription : DialogDescription;
  const left = Date.parse(st.endsAt) - now;
  const body = (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 sm:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] sm:p-7">
      <div className="space-y-3">
        <div className="frame rounded-sm"><FadeImage src={p.image} alt={p.alt || p.title} /></div>
        <p className="text-muted-foreground text-xs">{spec(p)}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <StatusBadge st={st} now={now} />
          <Title className="font-display mt-2 text-[1.6rem] leading-tight font-normal">{p.title}</Title>
          <Desc className="text-muted-foreground mt-1 text-sm">{p.description}</Desc>
        </div>
        <div className="bg-secondary/60 grid grid-cols-2 gap-3 rounded-2xl p-4">
          <div><p className="text-muted-foreground text-xs">{st.high == null ? "Starting bid" : "Current bid"}</p><p className="font-display text-primary text-2xl">{money(st.high ?? st.start)}</p><p className="text-muted-foreground text-xs">{st.count} bid{st.count === 1 ? "" : "s"}{st.leader ? ` · leading: ${st.leader}` : ""}</p></div>
          <div><p className="text-muted-foreground text-xs">{st.status === "live" ? "Ends in" : "Ended"}</p><p className={cn("font-display text-2xl tabular-nums", st.status === "live" && left < 120000 && "text-destructive")}>{st.status === "live" ? countdown(left) : new Date(st.endsAt).toLocaleDateString()}</p>{st.reserve === "not_met" && st.status === "live" && <p className="text-muted-foreground text-xs">Reserve not met yet</p>}</div>
        </div>
        <BidPanel key={p.id} p={p} st={st} now={now} onState={onState} />
        <Separator />
        <div>
          <h3 className="mb-2 text-sm font-medium">Bid history</h3>
          {st.bids.length ? (
            <ol className="max-h-56 space-y-1.5 overflow-y-auto text-sm" aria-label="Bid history">
              {st.bids.map((b, i) => (
                <li key={`${b.at}-${i}`} className={cn("flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5", i === 0 && "bg-accent/60")}>
                  <span className="font-mono">{b.name}</span><span className="text-muted-foreground text-xs">{ago(b.at, now)}</span><b className="ml-auto font-medium tabular-nums">{money(b.amount)}</b>
                </li>
              ))}
            </ol>
          ) : <p className="text-muted-foreground text-sm">No bids yet. Be the first!</p>}
        </div>
      </div>
    </div>
  );
  if (isPhone) return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent className="max-h-[94dvh]"><div className="min-h-0 overflow-y-auto overscroll-contain">{body}</div></DrawerContent></Drawer>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-[880px]">{body}</DialogContent></Dialog>;
}

// ---------- Section ----------
export function Auctions() {
  const { shop, money } = useStore();
  const a = shop.artist;
  const pieces = React.useMemo(() => shop.paintings.filter(isAuction), [shop.paintings]);
  const on = validCheckoutApi(a) && pieces.length > 0;
  const [states, setStates] = React.useState<Record<string, AuctionState>>({});
  const [skew, setSkew] = React.useState(0);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const now = useNow(skew);
  const sectionRef = React.useRef<HTMLElement>(null);

  // Poll every 5 seconds while the tab is visible; stop when it's hidden.
  React.useEffect(() => {
    if (!on) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const d = await getJson<{ auctions: AuctionState[]; now: string }>(api(a, "/api/auctions"));
        if (!alive) return;
        setSkew(Date.parse(d.now) - Date.now());
        setStates(Object.fromEntries(d.auctions.map((x) => [x.id, x])));
      } catch { /* keep the last known state; try again next tick */ }
    };
    const tick = () => { clearTimeout(timer); if (document.visibilityState !== "visible") return; load(); timer = setTimeout(tick, POLL_MS); };
    const onVisible = () => (document.visibilityState === "visible" ? tick() : clearTimeout(timer));
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [on, a]);

  const setOne = React.useCallback((s: AuctionState) => setStates((m) => ({ ...m, [s.id]: s })), []);
  const shown = pieces
    .map((p) => ({ p, st: states[p.id] }))
    .filter((x): x is { p: Painting; st: AuctionState } => Boolean(x.st) && (x.st.status === "live" || now - Date.parse(x.st.endsAt) < SHOW_CLOSED_MS))
    .sort((x, y) => Number(y.st.status === "live") - Number(x.st.status === "live") || Date.parse(x.st.endsAt) - Date.parse(y.st.endsAt));
  const anyLive = shown.some((x) => x.st.status === "live");

  // "#auctions" links (outbid emails) and "Bid in the auction" from a piece's page.
  React.useEffect(() => {
    if (anyLive && location.hash === "#auctions") sectionRef.current?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
  }, [anyLive]);
  React.useEffect(() => {
    const onOpen = (e: Event) => { const id = (e as CustomEvent<string>).detail; setOpenId(id); sectionRef.current?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" }); };
    addEventListener("open-auction", onOpen);
    return () => removeEventListener("open-auction", onOpen);
  }, []);

  if (!on || !anyLive) return null;
  const cur = shown.find((x) => x.p.id === openId);
  return (
    <section ref={sectionRef} id="auctions" aria-labelledby="auctions-title" className="mx-auto max-w-[1180px] scroll-mt-16 py-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 id="auctions-title" className="flex items-center gap-3 text-[2.2rem] leading-none">Auctions <Gavel className="text-primary size-7" strokeWidth={1.5} /></h2>
          <p className="text-muted-foreground mt-2 text-sm">One-of-a-kind pieces, sold to the highest bidder. Bids update live.</p>
        </div>
      </div>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(({ p, st }, i) => {
          const left = Date.parse(st.endsAt) - now;
          const live = st.status === "live";
          return (
            <li key={p.id} className="card-in bg-card flex flex-col overflow-hidden rounded-3xl border shadow-sm" style={{ "--i": i } as React.CSSProperties} data-auction={p.id}>
              <button type="button" className="group relative block text-left" onClick={() => setOpenId(p.id)} aria-label={`${p.title}: ${live ? "place a bid" : "see the result"}`}>
                <FadeImage src={p.image} alt={p.alt || p.title} className={cn("aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-[1.02]", !live && "saturate-[.7]")} />
                <span className="absolute top-3 left-3"><StatusBadge st={st} now={now} /></span>
              </button>
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div>
                  <h3 className="font-display text-xl leading-snug">{p.title}</h3>
                  <p className="text-muted-foreground text-[13px]">{spec(p)}</p>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-muted-foreground text-xs">{!live ? (st.status === "won" ? "Sold for" : "Highest bid") : st.high == null ? "Starting bid" : "Current bid"}</p>
                    <p className="font-display text-primary text-2xl" data-testid="current-bid">{st.status === "ended" && st.high == null ? "—" : money(st.high ?? st.start)}</p>
                    <p className="text-muted-foreground text-xs">{st.count} bid{st.count === 1 ? "" : "s"}{st.leader && live ? ` · ${st.leader}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground flex items-center justify-end gap-1 text-xs"><Clock className="size-3" />{live ? "Ends in" : st.status === "won" ? "Sold at auction" : "Ended"}</p>
                    <p className={cn("font-medium tabular-nums", live && left < 120000 && "text-destructive")} data-testid="countdown">{live ? countdown(left) : new Date(st.endsAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <Button className="mt-auto w-full" variant={live ? "default" : "outline"} onClick={() => setOpenId(p.id)}>{live ? <><Gavel /> Place bid</> : "See bids"}</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <BidDialog p={cur?.p} st={cur?.st} now={now} open={Boolean(cur)} onOpenChange={(o) => !o && setOpenId(null)} onState={setOne} />
    </section>
  );
}
