import * as React from "react";
import { ArrowLeft, Check, ShoppingBag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { InstagramIcon, PayPalIcon } from "@/components/icons";
import { Stepper } from "@/components/stepper";
import { petals } from "@/components/effects";
import {
  type Buyer, type OrderResult, ApiError, COUNTRIES, PROVINCES, STATES, addressLines, api, countryName, deliveryPayload,
  feeFor, igHandle, igUrl, payMode, postJson, reduceMotion, shipCfg, stockOf, validateBuyer,
} from "@/lib/shop";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/hooks/use-media-query";
import { type CartStep, useStore } from "@/store";

type Done = { kind: "saved" | "paid"; r: OrderResult };

const TITLES: Record<CartStep, string> = { cart: "Your cart", details: "Delivery details", pay: "Payment", done: "Order placed" };
const fine = "text-muted-foreground text-center text-[13px] leading-relaxed";

function TestBanner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-amber-500/50 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">{children}</p>;
}

function Totals({ withFee }: { withFee: boolean }) {
  const { shop, money, subtotal, buyer, currency } = useStore();
  const fee = withFee ? feeFor(shop.artist, buyer) : 0;
  const row = "flex items-baseline justify-between gap-4";
  return (
    <dl className="bg-muted/60 space-y-1.5 rounded-2xl p-4 text-sm">
      <div className={row}><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
      <div className={row}>
        <dt className="text-muted-foreground">{buyer.method === "pickup" && withFee ? "Pickup" : "Delivery"}</dt>
        <dd className="tabular-nums">{withFee ? (fee > 0 ? money(fee) : "Free") : "Next step"}</dd>
      </div>
      <Separator className="my-2" />
      <div className={cn(row, "text-base font-semibold")}><dt>Total</dt><dd className="tabular-nums">{money(subtotal + fee)} {currency}</dd></div>
    </dl>
  );
}

function StepsBar({ step }: { step: CartStep }) {
  const idx = { cart: 0, details: 1, pay: 2, done: 3 }[step];
  return (
    <ol aria-label="Checkout steps" className="flex gap-2 px-5 pb-3 text-xs font-medium">
      {["Cart", "Delivery", "Payment"].map((s, i) => (
        <li key={s} aria-current={i === idx ? "step" : undefined} className={cn("flex flex-1 flex-col gap-1.5", i <= idx ? "text-primary" : "text-muted-foreground")}>
          <span className={cn("h-1 rounded-full transition-colors", i < idx ? "bg-primary" : i === idx ? "bg-rose" : "bg-border")} />
          {s}
        </li>
      ))}
    </ol>
  );
}

// ---------- Step 1: cart ----------
function CartView() {
  const { shop, money, lines, cartNotes, setQty, removeLine, closeCart, setCartStep } = useStore();
  const a = shop.artist;
  return (
    <div className="space-y-4">
      {a.checkoutTest && <TestBanner>{payMode(a) === "paypal" ? "Test mode: payments use PayPal's sandbox. No real money is charged." : "Test mode: only people using the ?test link see this cart."}</TestBanner>}
      {cartNotes.map((n) => <p key={n} className="bg-secondary text-secondary-foreground rounded-xl px-3.5 py-2.5 text-sm">{n}</p>)}
      {!lines.length ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="bg-secondary text-primary mb-2 grid size-16 place-items-center rounded-full"><ShoppingBag className="size-7" strokeWidth={1.5} /></div>
          <p className="font-display text-xl">Your cart is empty</p>
          <p className="text-muted-foreground text-sm">Open any piece marked Available and tap “Add to cart”.</p>
          <Button className="mt-4" onClick={() => { closeCart(); setTimeout(() => document.getElementById("gallery")?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" }), 250); }}>Browse the shop</Button>
        </div>
      ) : (
        <>
          <ul className="divide-y">
            {lines.map((c) => {
              const left = Math.min(stockOf(c.p), 20);
              return (
                <li key={c.id} className="flex gap-3.5 py-4 first:pt-0">
                  <img src={c.p.image} alt="" width={80} height={100} loading="lazy" className="bg-muted h-[100px] w-20 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-display leading-snug">{c.p.title}</p>
                      <span className="shrink-0 font-medium tabular-nums">{money(c.p.price * c.qty)}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-[13px]">{money(c.p.price)} each · {left} available</p>
                    <div className="mt-2.5 flex items-center justify-between">
                      <Stepper value={c.qty} min={1} max={left} onChange={(v) => setQty(c.id, v)} label={c.p.title} />
                      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => removeLine(c.id)}><Trash2 /> Remove</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Totals withFee={false} />
          <Button size="lg" className="w-full" onClick={() => setCartStep("details")}>Checkout</Button>
          <p className={fine}>Pay securely on PayPal with your PayPal account or any debit or credit card.</p>
        </>
      )}
    </div>
  );
}

// ---------- Step 2: delivery details ----------
function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <small className="text-muted-foreground text-xs">{hint}</small>}
    </div>
  );
}

function DetailsView() {
  const { shop, buyer, setBuyer, setCartStep } = useStore();
  const cfg = shipCfg(shop.artist);
  const [err, setErr] = React.useState<[keyof Buyer, string] | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const method = cfg.pickup ? buyer.method : "ship";
  React.useEffect(() => { if (!cfg.pickup && buyer.method !== "ship") setBuyer((b) => ({ ...b, method: "ship" })); }, [cfg.pickup, buyer.method, setBuyer]);

  const set = (key: keyof Buyer) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setBuyer((b) => ({ ...b, [key]: v }));
    setErr(null);
  };
  const inv = (key: keyof Buyer) => (err && err[0] === key ? true : undefined);
  const input = (key: keyof Buyer, props: React.ComponentProps<typeof Input> = {}) => (
    <Input id={`f-${key}`} name={key} value={buyer[key]} onChange={set(key)} aria-invalid={inv(key)} {...props} />
  );
  const regions = buyer.country === "CA" ? PROVINCES : buyer.country === "US" ? STATES : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = validateBuyer({ ...buyer, method });
    if (bad) {
      setErr(bad);
      const f = formRef.current?.querySelector<HTMLElement>(`#f-${bad[0]}`);
      if (f) { f.focus(); f.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" }); }
      return;
    }
    setCartStep("pay");
  };

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="space-y-6">
      <RadioGroup
        aria-label="How would you like to get your order?"
        value={method}
        onValueChange={(v) => { setBuyer((b) => ({ ...b, method: v as Buyer["method"] })); setErr(null); }}
        className={cn("grid gap-2.5", cfg.pickup && "grid-cols-2")}
      >
        {[["ship", "Delivery", "Shipped to your door"] as const, ...(cfg.pickup ? [["pickup", "Pickup", cfg.pickupNote || "Collect from Sruthi"] as const] : [])].map(([id, title, sub]) => (
          <Label key={id} htmlFor={`m-${id}`}
            className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/60 bg-card flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 leading-snug transition">
            <RadioGroupItem id={`m-${id}`} value={id} className="mt-0.5" />
            <span className="grid gap-1"><strong className="font-medium">{title}</strong><small className="text-muted-foreground text-xs font-normal">{sub}</small></span>
          </Label>
        ))}
      </RadioGroup>

      <fieldset className="grid gap-3.5">
        <legend className="font-display mb-3 text-lg">Your details</legend>
        <Field id="f-name" label="Full name">{input("name", { autoComplete: "name" })}</Field>
        <Field id="f-email" label="Email" hint="For your PayPal receipt and order updates.">{input("email", { type: "email", autoComplete: "email", inputMode: "email" })}</Field>
        <Field id="f-phone" label="Phone" hint={method === "pickup" ? "Required for pickup." : "Optional, in case the courier needs it."}>{input("phone", { type: "tel", autoComplete: "tel", inputMode: "tel" })}</Field>
      </fieldset>

      {method === "ship" && (
        <fieldset className="grid gap-3.5">
          <legend className="font-display mb-3 text-lg">Delivery address</legend>
          <Field id="f-country" label="Country">
            <NativeSelect id="f-country" autoComplete="country" value={buyer.country}
              onChange={(e) => { const c = e.target.value; setBuyer((b) => { const opts = c === "CA" ? PROVINCES : c === "US" ? STATES : null; return { ...b, country: c, region: opts && !opts[b.region] ? "" : b.region }; }); setErr(null); }}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
            </NativeSelect>
          </Field>
          <Field id="f-line1" label="Street address">{input("line1", { autoComplete: "address-line1", placeholder: "123 Maple Street" })}</Field>
          <Field id="f-line2" label="Apartment, suite, unit (optional)">{input("line2", { autoComplete: "address-line2" })}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="f-city" label="City">{input("city", { autoComplete: "address-level2" })}</Field>
            <Field id="f-postal" label={buyer.country === "US" ? "ZIP code" : buyer.country === "CA" ? "Postal code" : "Postal code (if any)"}>
              {input("postal", { autoComplete: "postal-code", autoCapitalize: "characters", placeholder: buyer.country === "CA" ? "M5V 2T6" : buyer.country === "US" ? "10001" : "" })}
            </Field>
          </div>
          {regions ? (
            <Field id="f-region" label={buyer.country === "CA" ? "Province" : "State"}>
              <NativeSelect id="f-region" value={regions[buyer.region] ? buyer.region : ""} onChange={set("region")} aria-invalid={inv("region")}>
                <option value="">Choose…</option>
                {Object.entries(regions).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </NativeSelect>
            </Field>
          ) : (
            <Field id="f-region" label="State / province / region (optional)">{input("region", { autoComplete: "address-level1" })}</Field>
          )}
        </fieldset>
      )}

      <Field id="f-note" label="Note for Sruthi (optional)">
        <Textarea id="f-note" rows={2} maxLength={300} placeholder="Gift message, delivery instructions…" value={buyer.note} onChange={set("note")} />
      </Field>

      <Totals withFee />
      {err && <p role="alert" className="text-destructive bg-destructive/5 rounded-xl px-3.5 py-2.5 text-sm">{err[1]}</p>}
      <Button type="submit" size="lg" className="w-full">Continue to payment</Button>
    </form>
  );
}

// ---------- Step 3: payment ----------
function Recap() {
  const { shop, money, buyer, lines, count, setCartStep } = useStore();
  return (
    <div className="grid gap-3">
      <Card className="gap-2 py-4">
        <CardHeader><CardTitle className="text-sm">{buyer.method === "pickup" ? "Pickup" : "Delivering to"}</CardTitle><Button variant="link" size="sm" className="h-auto p-0" onClick={() => setCartStep("details")}>Change</Button></CardHeader>
        <CardContent>
          <address className="text-muted-foreground grid text-sm not-italic">{addressLines(shop.artist, buyer).map((l, i) => <span key={i}>{l}</span>)}</address>
          <p className="text-muted-foreground mt-1 text-sm">{[buyer.email.trim(), buyer.phone.trim()].filter(Boolean).join(" · ")}</p>
        </CardContent>
      </Card>
      <Card className="gap-2 py-4">
        <CardHeader><CardTitle className="text-sm">{count} item{count > 1 ? "s" : ""}</CardTitle><Button variant="link" size="sm" className="h-auto p-0" onClick={() => setCartStep("cart")}>Edit</Button></CardHeader>
        <CardContent>
          <ul className="grid gap-2">
            {lines.map((c) => (
              <li key={c.id} className="flex items-center gap-3 text-sm">
                <img src={c.p.image} alt="" width={44} height={55} className="bg-muted h-[55px] w-11 rounded-md object-cover" />
                <span className="flex-1">{c.p.title} × {c.qty}</span>
                <b className="font-medium tabular-nums">{money(c.p.price * c.qty)}</b>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Status({ msg }: { msg: { text: string; error?: boolean } | null }) {
  return <p role="status" className={cn("min-h-5 text-center text-sm", msg?.error ? "text-destructive" : "text-muted-foreground")}>{msg?.text}</p>;
}

// PayPal.me mode: save the order (pieces are reserved), then send the customer to pay the exact total.
function PayMeView({ onDone }: { onDone: (d: Done) => void }) {
  const { shop, money, subtotal, buyer, lines, currency } = useStore();
  const a = shop.artist;
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; error?: boolean } | null>(null);
  const total = subtotal + feeFor(a, buyer);
  const place = async () => {
    setBusy(true); setMsg({ text: "Saving your order…" });
    try {
      const r = await postJson<OrderResult>(api(a, "/api/requests"), { items: lines.map((c) => ({ id: c.id, qty: c.qty })), delivery: deliveryPayload(buyer) });
      onDone({ kind: "saved", r });
    } catch (e) {
      setBusy(false); setMsg({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="space-y-4">
      {a.checkoutTest && <TestBanner>Test mode: only people using the ?test link see the cart. Test orders are real, so cancel them in the studio afterwards.</TestBanner>}
      <Recap />
      <Totals withFee />
      <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm marker:text-primary">
        <li><b className="text-foreground font-medium">Place your order.</b> Your pieces are reserved for you.</li>
        <li><b className="text-foreground font-medium">Pay on PayPal.</b> We open Sruthi's PayPal page with the exact total filled in. Pay with your PayPal balance or a card.</li>
        <li><b className="text-foreground font-medium">Sruthi confirms</b>{buyer.method === "pickup" ? " and messages you to arrange the pickup." : " and ships to your address."}</li>
      </ol>
      <Button size="lg" variant="paypal" className="w-full" disabled={busy} onClick={place}><PayPalIcon /> Place order · {money(total)} {currency}</Button>
      <Status msg={msg} />
    </div>
  );
}

type PayPalButtons = { render: (el: HTMLElement) => Promise<void>; close?: () => void };
type PayPalSdk = { Buttons: (opts: Record<string, unknown>) => PayPalButtons };
declare global { interface Window { paypal?: PayPalSdk } }

let sdkPromise: Promise<PayPalSdk> | null = null;
function loadPayPal(clientId: string, currency: string) {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
      s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal didn't load")));
      s.onerror = () => { sdkPromise = null; reject(new Error("PayPal didn't load")); };
      document.head.append(s);
    });
  }
  return sdkPromise;
}

// PayPal mode: PayPal/card buttons; the Worker creates and captures the order.
function PayPalView({ onDone }: { onDone: (d: Done) => void }) {
  const { shop, buyer, lines, currency } = useStore();
  const a = shop.artist;
  const box = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "busy">("loading");
  const [msg, setMsg] = React.useState<{ text: string; error?: boolean } | null>(null);
  // Latest cart and buyer for PayPal's callbacks, which are created once.
  const latest = React.useRef({ lines, buyer });
  latest.current = { lines, buyer };
  const ig = igHandle(a);

  React.useEffect(() => {
    let alive = true;
    let buttons: PayPalButtons | null = null;
    loadPayPal(a.paypalClientId || "", currency).then((paypal) => {
      if (!alive || !box.current) return;
      setState("ready");
      buttons = paypal.Buttons({
        style: { layout: "vertical", shape: "pill", color: "gold", label: "pay", height: 48 },
        createOrder: async () => {
          setMsg(null);
          try {
            const { lines, buyer } = latest.current;
            return (await postJson<{ id: string }>(api(a, "/api/orders"), { items: lines.map((c) => ({ id: c.id, qty: c.qty })), delivery: deliveryPayload(buyer) })).id;
          } catch (e) {
            setMsg({ text: (e as Error).message, error: true });
            throw e;
          }
        },
        onApprove: async (data: { orderID: string }, actions: { restart: () => void }) => {
          setMsg({ text: "Confirming your payment…" }); setState("busy");
          try {
            const r = await postJson<OrderResult>(api(a, `/api/orders/${data.orderID}/capture`));
            onDone({ kind: "paid", r });
          } catch (e) {
            setState("ready");
            setMsg({ text: (e as Error).message, error: true });
            if (e instanceof ApiError && e.data.restart) return actions.restart();
          }
        },
        onCancel: () => setMsg({ text: "Payment cancelled. Nothing was charged." }),
        onError: () => setMsg((m) => m || { text: "PayPal hit a problem. Please try again in a moment.", error: true }),
      });
      buttons.render(box.current).catch(() => {});
    }).catch(() => {
      if (!alive) return;
      setState("ready");
      setMsg({ text: "Payment couldn't load. Check your connection and try again" + (ig ? `, or message @${ig} to order.` : "."), error: true });
    });
    return () => { alive = false; buttons?.close?.(); };
  }, []);

  return (
    <div className="space-y-4">
      {a.checkoutTest && <TestBanner>Test mode: use a PayPal sandbox buyer account. No real money is charged.</TestBanner>}
      <Recap />
      <Totals withFee />
      <div className={cn("min-h-[110px] transition-opacity", state === "busy" && "pointer-events-none opacity-50")}>
        {state === "loading" && <div className="grid gap-2.5"><span className="bg-muted h-12 animate-pulse rounded-full" /><span className="bg-muted h-12 animate-pulse rounded-full" /></div>}
        <div ref={box} />
      </div>
      <Status msg={msg} />
      <p className={fine}>You'll pay securely with PayPal or any debit or credit card. Your card details never touch this site.</p>
    </div>
  );
}

// ---------- Done ----------
function DoneView({ done }: { done: Done }) {
  const { shop, money, buyer, closeCart } = useStore();
  const { r, kind } = done;
  const ig = igHandle(shop.artist);
  const first = buyer.name.trim().split(/\s+/)[0] || "";
  const [copied, setCopied] = React.useState(false);
  const pickup = (r.method || buyer.method) === "pickup";
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <div className="bg-success/12 text-success grid size-16 place-items-center rounded-full">
        <svg className="tick size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <h3 className="font-display text-2xl">{first ? `Thank you, ${first}!` : "Thank you!"}</h3>
      <p>Order <b>{r.number || ""}</b>{kind === "saved" ? " is saved and your pieces are reserved." : ""}</p>
      <ul className="text-muted-foreground text-sm">{(r.items || []).map((i, k) => <li key={k}>{i.title} × {i.qty}</li>)}</ul>
      {kind === "saved" ? (
        <>
          <p className="bg-secondary text-secondary-foreground rounded-2xl px-4 py-3 text-sm">One last step: pay the total on PayPal. Please write your order number in the PayPal note so Sruthi can match your payment.</p>
          <Button asChild size="lg" variant="paypal" className="w-full"><a href={r.payUrl} target="_blank" rel="noopener"><PayPalIcon /> Pay {money(Number(r.total))} {r.currency || ""} on PayPal</a></Button>
          <Button variant="link" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(r.number || ""); setCopied(true); } catch { /* clipboard blocked */ } }}>
            {copied ? <><Check /> Order number copied</> : `Copy order number ${r.number}`}
          </Button>
          <p className="text-muted-foreground text-sm">{pickup ? "Once the payment arrives, Sruthi will message you to arrange the pickup." : "Once the payment arrives, Sruthi will pack and ship your order to the address you gave."}</p>
        </>
      ) : (
        <>
          <p className="text-sm">Paid {money(Number(r.total))} {r.currency || ""}. PayPal is emailing your receipt to {buyer.email.trim()}.</p>
          <p className="text-muted-foreground text-sm">{pickup ? "Sruthi has your order and will message you to arrange the pickup." : "Sruthi has your order and will ship it to the address you gave. Keep your order number handy if you have questions."}</p>
        </>
      )}
      {ig && <p className="text-muted-foreground text-sm">Questions? Message <a className="text-primary underline underline-offset-4" href={igUrl(shop.artist)} target="_blank" rel="noopener"><InstagramIcon className="mr-0.5 inline size-3.5 align-[-2px]" />@{ig}</a> with order {r.number || ""}.</p>}
      <Button variant="outline" className="mt-2" onClick={closeCart}>Keep browsing</Button>
    </div>
  );
}

// ---------- Panel ----------
export function CartPanel() {
  const { shop, cartOpen, cartStep, closeCart, setCartStep, clearCart, applyStock } = useStore();
  const isPhone = useIsPhone();
  const [done, setDone] = React.useState<Done | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [cartStep]);
  React.useEffect(() => { if (cartStep !== "done") setDone(null); }, [cartStep]);

  const finish = (d: Done) => {
    applyStock(d.r.stock);
    clearCart();
    setDone(d);
    setCartStep("done");
    petals();
  };

  const title = cartStep === "done" && done?.kind === "saved" ? "Almost done" : TITLES[cartStep];
  const body = (
    <>
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        {(cartStep === "details" || cartStep === "pay") && (
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => setCartStep(cartStep === "pay" ? "details" : "cart")}><ArrowLeft /></Button>
        )}
        {isPhone ? <DrawerTitle className="font-display text-xl font-normal">{title}</DrawerTitle> : <SheetTitle className="font-display text-xl font-normal">{title}</SheetTitle>}
        {isPhone ? <DrawerDescription className="sr-only">Cart and checkout</DrawerDescription> : <SheetDescription className="sr-only">Cart and checkout</SheetDescription>}
      </div>
      {cartStep !== "done" && <StepsBar step={cartStep} />}
      <Separator />
      <div ref={bodyRef} className="flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {cartStep === "cart" && <CartView />}
        {cartStep === "details" && <DetailsView />}
        {cartStep === "pay" && (payMode(shop.artist) === "paypal" ? <PayPalView onDone={finish} /> : <PayMeView onDone={finish} />)}
        {cartStep === "done" && done && <DoneView done={done} />}
      </div>
    </>
  );
  const onOpenChange = (o: boolean) => { if (!o) closeCart(); };

  if (isPhone) {
    return (
      <Drawer open={cartOpen} onOpenChange={onOpenChange} repositionInputs={false}>
        <DrawerContent className="h-[92dvh]">{body}</DrawerContent>
      </Drawer>
    );
  }
  return (
    <Sheet open={cartOpen} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0">{body}</SheetContent>
    </Sheet>
  );
}
