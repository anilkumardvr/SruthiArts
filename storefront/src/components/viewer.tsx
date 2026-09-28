import * as React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { FadeImage } from "@/components/fade-image";
import { InstagramIcon, PayPalIcon } from "@/components/icons";
import { Stepper } from "@/components/stepper";
import { type Painting, igHandle, igUrl, isAuction, isSold, mailto, paypalUrl, photosOf, spec, stockLabel, stockOf } from "@/lib/shop";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/hooks/use-media-query";
import { useStore } from "@/store";

// Swipe through this piece's photos first, then on to the next piece (like Instagram).
function Photos({ p, onStep }: { p: Painting; onStep: (d: number) => void }) {
  const photos = photosOf(p);
  const multi = photos.length > 1;
  const [api, setApi] = React.useState<CarouselApi>();
  const [index, setIndex] = React.useState(0);
  const touch = React.useRef<{ x: number; y: number; at: number } | null>(null);

  React.useEffect(() => {
    if (!api) return;
    const on = () => setIndex(api.selectedScrollSnap());
    on();
    api.on("select", on);
    return () => { api.off("select", on); };
  }, [api]);

  return (
    <div
      data-vaul-no-drag
      className="bg-muted/60 relative"
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, at: index }; }}
      onTouchEnd={(e) => {
        const s = touch.current; touch.current = null;
        if (!s) return;
        const t = e.changedTouches[0], mx = t.clientX - s.x, my = t.clientY - s.y;
        if (Math.abs(mx) < 50 || Math.abs(mx) < Math.abs(my) * 1.5) return;
        const d = mx < 0 ? 1 : -1;
        if (!multi || (d > 0 && s.at === photos.length - 1) || (d < 0 && s.at === 0)) onStep(d);
      }}
    >
      <Carousel setApi={setApi} opts={{ loop: false }} aria-label={`${p.title} photos`}>
        <CarouselContent className="ml-0">
          {photos.map((src, k) => (
            <CarouselItem key={src} className="grid place-items-center pl-0">
              <FadeImage
                src={src}
                alt={multi ? `${p.alt || p.title} (photo ${k + 1} of ${photos.length})` : p.alt || p.title}
                className="h-[min(56dvh,560px)] w-full object-contain md:h-[min(78dvh,680px)]"
                draggable={false}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        {multi && (
          <>
            <CarouselPrevious className="bg-card/90 top-1/2 left-3 -translate-y-1/2 shadow-md disabled:opacity-0" />
            <CarouselNext className="bg-card/90 top-1/2 right-3 -translate-y-1/2 shadow-md disabled:opacity-0" />
          </>
        )}
      </Carousel>
      {multi && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
          {photos.map((_, k) => (
            <button
              key={k}
              type="button"
              aria-label={`Photo ${k + 1} of ${photos.length}`}
              aria-current={k === index ? "true" : undefined}
              onClick={() => api?.scrollTo(k)}
              className={cn("h-2 rounded-full bg-card/80 shadow-sm transition-all", k === index ? "bg-primary w-5" : "w-2")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Viewer buttons when the cart is on: quantity, Add to cart, Buy now.
function CartBlock({ p }: { p: Painting }) {
  const { money, inCart, addToCart, openCart } = useStore();
  const left = Math.min(stockOf(p), 20);
  const [qty, setQty] = React.useState(1);
  const [added, setAdded] = React.useState(0);
  const have = inCart(p.id);
  const room = left - have;
  return (
    <div className="space-y-3">
      {left > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">Quantity</span>
          <Stepper value={qty} min={1} max={left} onChange={setQty} label={p.title} />
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Button size="lg" disabled={room < 1} onClick={() => setAdded(addToCart(p, qty))}>
          {room < 1 ? (have ? "All available are in your cart" : "Sold out") : `Add to cart · ${money(p.price * Math.min(qty, room))}`}
        </Button>
        <Button size="lg" variant="outline" onClick={() => { const want = Math.min(qty, left); if (inCart(p.id) < want) addToCart(p, want - inCart(p.id)); openCart("details"); }}>
          Buy now
        </Button>
      </div>
      {added > 0 && (
        <p role="status" className="text-success text-sm">
          Added {added} to your cart.{" "}
          <button type="button" className="text-primary font-medium underline underline-offset-4" onClick={() => openCart()}>View cart</button>
        </p>
      )}
    </div>
  );
}

function Actions({ p }: { p: Painting }) {
  const { shop, money, cartEnabled, closePiece } = useStore();
  const a = shop.artist;
  const ig = igHandle(a);
  const fine = "text-muted-foreground text-[13px] leading-relaxed";
  if (isAuction(p)) {
    return (
      <div className="grid gap-2">
        <Button size="lg" onClick={() => { closePiece(); setTimeout(() => dispatchEvent(new CustomEvent("open-auction", { detail: p.id })), 250); }}>Bid in the auction</Button>
        <p className={fine}>This piece is sold by timed auction to the highest bidder.</p>
      </div>
    );
  }
  if (isSold(p)) {
    return ig ? <p className={fine}>Love this one? <a className="text-primary underline underline-offset-4" href={igUrl(a)} target="_blank" rel="noopener">Message @{ig}</a> about similar pieces or a commission.</p> : null;
  }
  if (cartEnabled) {
    return (
      <div className="space-y-3">
        <CartBlock key={p.id} p={p} />
        {ig && <Button asChild variant="ghost" size="sm" className="text-primary"><a href={igUrl(a)} target="_blank" rel="noopener"><InstagramIcon /> Ask a question on Instagram</a></Button>}
      </div>
    );
  }
  const pp = paypalUrl(a, p);
  if (pp) {
    return (
      <div className="grid gap-2">
        <Button asChild size="lg" variant="paypal"><a href={pp} target="_blank" rel="noopener"><PayPalIcon /> Buy with PayPal · {money(p.price)}</a></Button>
        {ig && <Button asChild size="lg" variant="outline"><a href={igUrl(a)} target="_blank" rel="noopener"><InstagramIcon /> Ask a question on Instagram</a></Button>}
        <p className={fine}>{ig ? `After paying, message @${ig} with “${p.title}” and your address so Sruthi can arrange delivery.` : "After paying, Sruthi will contact you through PayPal to arrange delivery."}</p>
      </div>
    );
  }
  if (ig) {
    return (
      <div className="grid gap-2">
        <Button asChild size="lg"><a href={igUrl(a)} target="_blank" rel="noopener"><InstagramIcon /> Buy on Instagram</a></Button>
        <p className={fine}>Message @{ig} with “{p.title}” to reserve it.</p>
      </div>
    );
  }
  if (a.email) return <Button asChild size="lg"><a href={mailto(a, `Enquiry: ${p.title}`)}>Enquire about this piece</a></Button>;
  return null;
}

function ViewerBody({ p, onStep, Title, Description }: { p: Painting; onStep: (d: number) => void; Title: typeof DialogTitle | typeof DrawerTitle; Description: typeof DialogDescription | typeof DrawerDescription }) {
  const { shop, money } = useStore();
  const sold = isSold(p);
  return (
    <div className="grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Photos key={p.id} p={p} onStep={onStep} />
      <div className="flex flex-col gap-4 p-5 sm:p-7">
        <div>
          <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">{shop.artist.name || "Sruthi"}</p>
          <Title className="font-display mt-1.5 text-[1.75rem] leading-tight font-normal">{p.title}</Title>
          {spec(p) && <p className="text-muted-foreground mt-1 text-sm">{spec(p)}</p>}
        </div>
        <Description className="text-foreground/85 text-[.97rem] leading-relaxed">{p.description}</Description>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={cn("font-display text-2xl", sold ? "text-muted-foreground text-lg italic" : "text-primary")}>{sold ? "Sold — in a private collection" : money(p.price)}</p>
          {!sold && <Badge variant="success">{stockLabel(p)}</Badge>}
        </div>
        <Actions p={p} />
        <Separator className="mt-auto" />
        <div className="flex justify-between">
          <Button variant="ghost" size="sm" onClick={() => onStep(-1)}><ArrowLeft /> Previous</Button>
          <Button variant="ghost" size="sm" onClick={() => onStep(1)}>Next <ArrowRight /></Button>
        </div>
      </div>
    </div>
  );
}

// Bottom sheet on phones (drag down to close), dialog on larger screens.
export function Viewer() {
  const { shop, current, openPiece, closePiece } = useStore();
  const isPhone = useIsPhone();
  const p = shop.paintings[current];
  const n = shop.paintings.length;
  const step = (d: number) => openPiece((current + d + n) % n);
  const open = Boolean(p);

  // Keep the last piece on screen while the sheet animates closed.
  const [shown, setShown] = React.useState<Painting | undefined>(p);
  React.useEffect(() => { if (p) setShown(p); }, [p]);
  const piece = p || shown;
  const onOpenChange = (o: boolean) => { if (!o) closePiece(); };

  if (isPhone) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {piece && <ViewerBody p={piece} onStep={step} Title={DrawerTitle} Description={DrawerDescription} />}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-[1040px]"
        onKeyDown={(e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); }}
      >
        {piece && <ViewerBody p={piece} onStep={step} Title={DialogTitle} Description={DialogDescription} />}
      </DialogContent>
    </Dialog>
  );
}
