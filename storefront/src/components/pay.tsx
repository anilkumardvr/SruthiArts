import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { PayPalIcon } from "@/components/icons";
import { Field, loadPayPal } from "@/components/cart";
import { petals } from "@/components/effects";
import {
  type Buyer, ApiError, COUNTRIES, PROVINCES, STATES, api, countryName, deliveryPayload, emptyBuyer, getJson, makeMoney, postJson, validCheckoutApi, validateBuyer,
} from "@/lib/shop";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/hooks/use-media-query";
import { useStore } from "@/store";

// The auction winner's pay page: the email links to #pay/<order number>/<token>.
type PayInfo = {
  number: string; status: "awaiting" | "new" | "packed" | "shipped" | "cancelled"; cancelReason: string;
  items: { id: string; title: string; qty: number; price: number; image: string }[];
  subtotal: number; amount: number; currency: string; payBy: string; name: string; email: string;
  ship: { CA: number; US: number; intl: number; pickup: boolean; pickupNote: string };
  mode: "paypal" | "paypalme"; paypalClientId?: string;
};
const parseHash = () => { const m = location.hash.match(/^#pay\/(SA-[A-Z0-9]{4,16})\/([A-Za-z0-9_-]{10,64})$/); return m ? { number: m[1], token: m[2] } : null; };

function PayBody({ number, token, info, onDone }: { number: string; token: string; info: PayInfo; onDone: (msg: string) => void }) {
  const { shop } = useStore();
  const money = React.useMemo(() => makeMoney(info.currency), [info.currency]);
  const a = shop.artist;
  const [b, setB] = React.useState<Buyer>(() => ({ ...emptyBuyer(), name: info.name || "", email: info.email }));
  const [err, setErr] = React.useState<[keyof Buyer, string] | null>(null);
  const [stage, setStage] = React.useState<"form" | "pay">("form");
  const [payUrl, setPayUrl] = React.useState("");
  const [msg, setMsg] = React.useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  const fee = b.method === "pickup" ? 0 : b.country === "CA" ? info.ship.CA : b.country === "US" ? info.ship.US : info.ship.intl;
  const total = info.subtotal + fee;
  const regions = b.country === "CA" ? PROVINCES : b.country === "US" ? STATES : null;
  const set = (k: keyof Buyer) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { const v = e.target.value; setB((x) => ({ ...x, [k]: v })); setErr(null); };
  const inv = (k: keyof Buyer) => (err && err[0] === k ? true : undefined);
  const piece = info.items[0];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = validateBuyer(b);
    if (bad) { setErr(bad); document.getElementById(`w-${bad[0]}`)?.focus(); return; }
    if (info.mode === "paypalme") {
      setBusy(true); setMsg(null);
      try {
        const r = await postJson<{ payUrl: string }>(api(a, `/api/pay/${number}/delivery`), { t: token, delivery: deliveryPayload(b) });
        setPayUrl(r.payUrl); setStage("pay");
      } catch (e2) { setMsg({ text: (e2 as Error).message, error: true }); } finally { setBusy(false); }
    } else setStage("pay");
  };

  // PayPal Checkout: buttons render once the address is in; the server adds the delivery fee.
  React.useEffect(() => {
    if (stage !== "pay" || info.mode !== "paypal") return;
    let alive = true;
    loadPayPal(info.paypalClientId || a.paypalClientId || "", info.currency).then((paypal) => {
      if (!alive || !box.current) return;
      paypal.Buttons({
        style: { layout: "vertical", shape: "pill", color: "gold", label: "pay", height: 48 },
        createOrder: async () => {
          setMsg(null);
          try { return (await postJson<{ id: string }>(api(a, `/api/pay/${number}/paypal`), { t: token, delivery: deliveryPayload(b) })).id; }
          catch (e) { setMsg({ text: (e as Error).message, error: true }); throw e; }
        },
        onApprove: async (data: { orderID: string }, actions: { restart: () => void }) => {
          setMsg({ text: "Confirming your payment…" });
          try {
            await postJson(api(a, `/api/pay/${number}/capture`), { t: token, orderID: data.orderID });
            onDone(`Paid ${money(total)}. PayPal is emailing your receipt. Sruthi will ${b.method === "pickup" ? "message you to arrange the pickup" : "pack and ship it to you"}.`);
          } catch (e) {
            setMsg({ text: (e as Error).message, error: true });
            if (e instanceof ApiError && e.data.restart) actions.restart();
          }
        },
        onCancel: () => setMsg({ text: "Payment cancelled. Nothing was charged." }),
      }).render(box.current).catch(() => {});
    }).catch(() => setMsg({ text: "PayPal couldn't load. Check your connection and try again.", error: true }));
    return () => { alive = false; };
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        {piece.image && <img src={piece.image} alt="" className="bg-muted h-24 w-20 shrink-0 rounded-lg object-cover" />}
        <div>
          <p className="font-display text-lg leading-snug">{piece.title}</p>
          <p className="text-muted-foreground text-sm">Your winning bid: <b className="text-foreground">{money(info.subtotal)}</b></p>
          <p className="text-muted-foreground text-sm">Order {number} · please pay by {new Date(info.payBy).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
      </div>
      {stage === "form" ? (
        <form noValidate onSubmit={submit} className="space-y-4">
          <RadioGroup value={b.method} onValueChange={(v) => setB((x) => ({ ...x, method: v as Buyer["method"] }))} className={cn("grid gap-2.5", info.ship.pickup && "grid-cols-2")} aria-label="Delivery or pickup">
            {[["ship", "Delivery", "Shipped to your door"] as const, ...(info.ship.pickup ? [["pickup", "Pickup", info.ship.pickupNote || "Collect from Sruthi"] as const] : [])].map(([id, t, sub]) => (
              <Label key={id} htmlFor={`wm-${id}`} className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/60 bg-card flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 leading-snug">
                <RadioGroupItem id={`wm-${id}`} value={id} className="mt-0.5" />
                <span className="grid gap-1"><strong className="font-medium">{t}</strong><small className="text-muted-foreground text-xs font-normal">{sub}</small></span>
              </Label>
            ))}
          </RadioGroup>
          <Field id="w-name" label="Full name"><Input id="w-name" autoComplete="name" value={b.name} onChange={set("name")} aria-invalid={inv("name")} /></Field>
          <Field id="w-phone" label="Phone" hint={b.method === "pickup" ? "Required for pickup." : "Optional, in case the courier needs it."}><Input id="w-phone" type="tel" autoComplete="tel" value={b.phone} onChange={set("phone")} aria-invalid={inv("phone")} /></Field>
          {b.method === "ship" && (
            <>
              <Field id="w-country" label="Country">
                <NativeSelect id="w-country" value={b.country} onChange={(e) => { const c = e.target.value; setB((x) => ({ ...x, country: c, region: "" })); }}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
                </NativeSelect>
              </Field>
              <Field id="w-line1" label="Street address"><Input id="w-line1" autoComplete="address-line1" value={b.line1} onChange={set("line1")} aria-invalid={inv("line1")} /></Field>
              <Field id="w-line2" label="Apartment, suite, unit (optional)"><Input id="w-line2" autoComplete="address-line2" value={b.line2} onChange={set("line2")} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="w-city" label="City"><Input id="w-city" autoComplete="address-level2" value={b.city} onChange={set("city")} aria-invalid={inv("city")} /></Field>
                <Field id="w-postal" label={b.country === "US" ? "ZIP code" : "Postal code"}><Input id="w-postal" autoComplete="postal-code" value={b.postal} onChange={set("postal")} aria-invalid={inv("postal")} /></Field>
              </div>
              {regions ? (
                <Field id="w-region" label={b.country === "CA" ? "Province" : "State"}>
                  <NativeSelect id="w-region" value={b.region} onChange={set("region")} aria-invalid={inv("region")}>
                    <option value="">Choose…</option>
                    {Object.entries(regions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </NativeSelect>
                </Field>
              ) : <Field id="w-region" label="State / province / region (optional)"><Input id="w-region" value={b.region} onChange={set("region")} /></Field>}
            </>
          )}
          <dl className="bg-muted/60 space-y-1.5 rounded-2xl p-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Winning bid</dt><dd>{money(info.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{b.method === "pickup" ? "Pickup" : "Delivery"}</dt><dd>{fee ? money(fee) : "Free"}</dd></div>
            <Separator className="my-2" />
            <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd data-testid="pay-total">{money(total)} {info.currency}</dd></div>
          </dl>
          {err && <p role="alert" className="text-destructive text-sm">{err[1]}</p>}
          {msg && <p role="status" className={cn("text-sm", msg.error ? "text-destructive" : "text-muted-foreground")}>{msg.text}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Saving…" : "Continue to payment"}</Button>
        </form>
      ) : info.mode === "paypalme" ? (
        <div className="space-y-4 text-center">
          <p className="bg-secondary text-secondary-foreground rounded-2xl px-4 py-3 text-sm">Pay the total on Sruthi's PayPal page. Please write <b>{number}</b> in the PayPal note so she can match your payment.</p>
          <Button asChild size="lg" variant="paypal" className="w-full"><a href={payUrl} target="_blank" rel="noopener"><PayPalIcon /> Pay {money(total)} {info.currency} on PayPal</a></Button>
          <p className="text-muted-foreground text-sm">Once it arrives, Sruthi {b.method === "pickup" ? "messages you to arrange the pickup" : "ships it to the address you gave"}.</p>
          <Button variant="link" size="sm" onClick={() => setStage("form")}>Change delivery details</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-center text-sm">Total <b>{money(total)} {info.currency}</b> · pay with PayPal or a card</p>
          <div ref={box} className="min-h-[110px]" />
          {msg && <p role="status" className={cn("text-center text-sm", msg.error ? "text-destructive" : "text-muted-foreground")}>{msg.text}</p>}
          <Button variant="link" size="sm" className="w-full" onClick={() => setStage("form")}>Change delivery details</Button>
        </div>
      )}
    </div>
  );
}

export function WinnerPay() {
  const { shop } = useStore();
  const isPhone = useIsPhone();
  const [target, setTarget] = React.useState(parseHash);
  const [info, setInfo] = React.useState<PayInfo | null>(null);
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState("");
  React.useEffect(() => { const on = () => setTarget(parseHash()); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  React.useEffect(() => {
    if (!target || !validCheckoutApi(shop.artist)) return;
    setInfo(null); setError(""); setDone("");
    getJson<PayInfo>(api(shop.artist, `/api/pay/${target.number}?t=${encodeURIComponent(target.token)}`)).then(setInfo).catch((e) => setError((e as Error).message));
  }, [target, shop.artist]);
  if (!target) return null;
  const close = () => { history.replaceState(null, "", location.pathname + location.search); setTarget(null); };
  const money = makeMoney(info?.currency || shop.artist.currency);
  const content = done ? (
    <div className="space-y-3 py-6 text-center"><p className="font-display text-2xl">Thank you!</p><p>{done}</p><Button variant="outline" onClick={close}>Back to the shop</Button></div>
  ) : error ? <p className="text-destructive py-6 text-center">{error}</p>
    : !info ? <p className="text-muted-foreground animate-pulse py-10 text-center">Loading your order…</p>
    : info.status !== "awaiting" ? (
      <p className="py-6 text-center">{info.status === "cancelled" ? "This order was cancelled because payment didn't arrive within 48 hours. Please message Sruthi if you'd still like the piece." : `Order ${info.number} is paid (${money(info.amount)}). Thank you!`}</p>
    ) : <PayBody number={target.number} token={target.token} info={info} onDone={(m) => { setDone(m); petals(); }} />;
  const T = isPhone ? DrawerTitle : DialogTitle, D = isPhone ? DrawerDescription : DialogDescription;
  const inner = <div className="p-5 sm:p-7"><T className="font-display mb-1 text-2xl font-normal">Pay for your auction win</T><D className="text-muted-foreground mb-5 text-sm">Choose delivery or pickup, then pay securely with PayPal.</D>{content}</div>;
  if (isPhone) return <Drawer open onOpenChange={(o) => !o && close()}><DrawerContent className="max-h-[94dvh]"><div className="min-h-0 overflow-y-auto overscroll-contain">{inner}</div></DrawerContent></Drawer>;
  return <Dialog open onOpenChange={(o) => !o && close()}><DialogContent className="max-h-[92dvh] overflow-y-auto p-0 sm:max-w-lg">{inner}</DialogContent></Dialog>;
}
