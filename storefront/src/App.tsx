import * as React from "react";

import { Auctions } from "@/components/auctions";
import { CartPanel } from "@/components/cart";
import { FairyDust } from "@/components/effects";
import { Gallery } from "@/components/gallery";
import { About, Contact, Hero, HowToBuy, SiteFooter, SiteHeader, TabBar } from "@/components/sections";
import { Viewer } from "@/components/viewer";
import { WinnerPay } from "@/components/pay";
import type { Shop } from "@/lib/shop";
import { StoreProvider, useStore } from "@/store";

// Each piece has a shareable link: #<item id> opens it in the viewer.
function HashLinks() {
  const { shop, current, openPiece } = useStore();
  const ps = shop.paintings;
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    const fromHash = () => {
      const idx = ps.findIndex((p) => `#${p.id}` === location.hash);
      if (idx >= 0) openPiece(idx);
    };
    fromHash();
    addEventListener("hashchange", fromHash);
    return () => removeEventListener("hashchange", fromHash);
    // Only on first load and on hash changes, not when stock updates.
  }, []);
  React.useEffect(() => {
    const p = ps[current];
    if (p) {
      wasOpen.current = true;
      if (location.hash !== `#${p.id}`) history.replaceState(null, "", `#${p.id}`);
      document.title = `${p.title} · Sruthi Arts`;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      document.title = "Sruthi Arts";
      if (ps.some((x) => `#${x.id}` === location.hash)) history.replaceState(null, "", location.pathname + location.search);
    }
  }, [current, ps]);
  return null;
}

function Storefront() {
  return (
    <div className="min-h-dvh px-4 pb-[calc(64px+env(safe-area-inset-bottom))] sm:px-8 sm:pb-0">
      <a href="#gallery" className="bg-primary text-primary-foreground sr-only z-50 rounded-full px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to the shop</a>
      <SiteHeader />
      <main id="top">
        <Hero />
        <Auctions />
        <Gallery />
        <About />
        <HowToBuy />
        <Contact />
      </main>
      <SiteFooter />
      <TabBar />
      <Viewer />
      <CartPanel />
      <WinnerPay />
      <HashLinks />
      <FairyDust />
    </div>
  );
}

export default function App() {
  const [shop, setShop] = React.useState<Shop | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    // "no-cache" makes the browser check for a newer copy every visit, so admin edits show up right after each deploy.
    fetch("data/shop.json", { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((data) => setShop({ artist: data.artist || {}, pages: data.pages || null, paintings: data.paintings || [] }))
      .catch(() => setFailed(true));
  }, []);

  if (!shop) {
    return (
      <div className="grid min-h-dvh place-items-center px-4 text-center">
        {failed ? (
          <p className="text-muted-foreground">The shop couldn’t load. Refresh the page to try again.</p>
        ) : (
          <p className="font-wordmark text-foreground/70 animate-pulse text-2xl tracking-[0.28em]" aria-label="Loading">SRUTHI<span className="text-rose mx-1.5">·</span>ARTS</p>
        )}
      </div>
    );
  }
  return (
    <StoreProvider initial={shop}>
      <Storefront />
    </StoreProvider>
  );
}
