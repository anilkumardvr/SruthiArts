import * as React from "react";
import { Copy, LayoutGrid, ShoppingBag, ShoppingCart, UserRound, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FadeImage } from "@/components/fade-image";
import { InstagramIcon } from "@/components/icons";
import { DEFAULT_PAGES, igHandle, igUrl, isSold, mailto, reduceMotion, text } from "@/lib/shop";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

function CartButton({ className, label = false }: { className?: string; label?: boolean }) {
  const { cartEnabled, count, bump, openCart } = useStore();
  if (!cartEnabled) return null;
  return (
    <button
      type="button"
      onClick={() => openCart()}
      aria-label={count ? `Cart, ${count} item${count > 1 ? "s" : ""}` : "Cart"}
      className={cn("relative", className)}
    >
      <ShoppingCart key={bump} className={cn("size-5", bump > 0 && "bump")} strokeWidth={1.8} />
      {label && <span>Cart</span>}
      {count > 0 && (
        <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] leading-none font-semibold">
          {count}
        </span>
      )}
    </button>
  );
}

export function SiteHeader() {
  const { shop } = useStore();
  const ig = igHandle(shop.artist);
  return (
    <header className="bg-background/80 sticky top-0 z-40 -mx-4 border-b border-transparent px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/65 sm:-mx-8 sm:px-8">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4">
        <a href="#top" aria-label="Sruthi Arts, back to top" className="font-wordmark text-foreground text-xl tracking-[0.28em] no-underline sm:text-2xl">
          <span aria-hidden="true">SRUTHI<span className="text-rose mx-1.5">·</span>ARTS</span>
        </a>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-2">
          <div className="hidden items-center gap-1 sm:flex">
            <Button asChild variant="ghost" size="sm"><a href="#gallery">Shop</a></Button>
            <Button asChild variant="ghost" size="sm"><a href="#about">About</a></Button>
            <Button asChild variant="ghost" size="sm"><a href="#buy">How to buy</a></Button>
          </div>
          {ig && (
            <Button asChild variant="ghost" size="sm" className="text-primary hidden sm:inline-flex">
              <a href={igUrl(shop.artist)} target="_blank" rel="noopener" aria-label={`Instagram @${ig}`}><InstagramIcon /><span className="hidden md:inline">@{ig}</span></a>
            </Button>
          )}
          <CartButton className="hover:bg-accent text-foreground grid size-10 place-items-center rounded-full transition" />
        </nav>
      </div>
    </header>
  );
}

// Headline words rise in one by one.
function Rise({ words, start }: { words: string; start: number }) {
  if (reduceMotion()) return <>{words}</>;
  const list = words.trim().split(/\s+/);
  return <>{list.map((w, i) => <React.Fragment key={i}><span className="rise-word" style={{ "--d": start + i } as React.CSSProperties}>{w}</span>{i < list.length - 1 ? " " : ""}</React.Fragment>)}</>;
}

export function Hero() {
  const { shop } = useStore();
  const hero = { ...DEFAULT_PAGES.hero, ...shop.pages?.hero };
  const title = text(hero.title, DEFAULT_PAGES.hero.title);
  const accent = text(hero.titleAccent, DEFAULT_PAGES.hero.titleAccent);
  const piece = shop.paintings.find((x) => !isSold(x)) || shop.paintings[0];
  const ig = igHandle(shop.artist);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const artRef = React.useRef<HTMLElement>(null);

  // Gentle 3D tilt for mouse users; the painting drifts slower than the page on scroll.
  React.useEffect(() => {
    if (reduceMotion()) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => { if (artRef.current) artRef.current.style.translate = `0 ${Math.min(scrollY, 900) * 0.12}px`; ticking = false; });
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  const tilt = (e: React.PointerEvent<HTMLElement>) => {
    if (reduceMotion() || e.pointerType !== "mouse" || !frameRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    frameRef.current.style.transform = `perspective(900px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
  };

  return (
    <section aria-labelledby="hero-title" onPointerMove={tilt} onPointerLeave={() => frameRef.current && (frameRef.current.style.transform = "")}
      className="relative mx-auto grid max-w-[1180px] items-center gap-10 pt-8 pb-14 sm:pt-14 md:grid-cols-[1.1fr_.9fr] md:gap-14 md:pb-24">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        {[[12, 18], [78, 8], [88, 62], [40, 82], [6, 70], [60, 30], [30, 45]].map(([l, t], i) => (
          <i key={i} className="sparkle" style={{ left: `${l}%`, top: `${t}%`, animationDelay: `${i * 0.45}s` }} />
        ))}
      </div>
      <div>
        <Badge variant="secondary" className="mb-5 px-3 py-1 text-[11px] tracking-[0.16em] uppercase">{text(hero.eyebrow, DEFAULT_PAGES.hero.eyebrow)}</Badge>
        <h1 id="hero-title" className="text-[clamp(2.4rem,6vw+.25rem,4.2rem)] leading-[1.05]">
          <Rise words={title} start={0} /> <em className="text-primary italic"><Rise words={accent} start={title.split(/\s+/).length} /></em>
        </h1>
        <p className="text-muted-foreground mt-5 max-w-[34rem] text-lg leading-relaxed">{text(hero.intro, DEFAULT_PAGES.hero.intro)}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg"><a href="#gallery">Browse the shop</a></Button>
          {ig && <Button asChild size="lg" variant="outline"><a href={igUrl(shop.artist)} target="_blank" rel="noopener"><InstagramIcon /> Follow on Instagram</a></Button>}
        </div>
      </div>
      <figure ref={artRef} aria-hidden="true" className="mx-auto w-full max-w-[380px] md:max-w-[420px]">
        {piece && (
          <div ref={frameRef} className="frame rotate-[1.5deg] rounded-sm will-change-transform">
            <FadeImage src={piece.image} alt="" width={800} height={1000} />
          </div>
        )}
      </figure>
    </section>
  );
}

// Sections fade up as they scroll into view.
function useReveal<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) { node.classList.add("is-in"); return; }
    const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { node.classList.add("is-in"); io.disconnect(); } }, { rootMargin: "0px 0px -10% 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return ref;
}

const SectionTitle = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="text-[1.9rem] leading-tight sm:text-[2.2rem]">{children}</h2>
);

export function About() {
  const { shop } = useStore();
  const about = shop.pages?.about || {};
  const paras = text(about.text, DEFAULT_PAGES.about.text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} id="about" aria-labelledby="about-title" className="reveal bg-card/70 mx-auto my-10 grid max-w-[1180px] gap-8 rounded-[2rem] border p-7 shadow-sm sm:p-12 md:grid-cols-[auto_1fr] md:items-center">
      <div className="flex items-center gap-5 md:flex-col md:items-start">
        {about.photo && (
          <img src={about.photo} alt={about.photoAlt || `Photo of ${shop.artist.name || "the artist"}`}
            className="ring-rosegold/50 size-24 shrink-0 rounded-full object-cover ring-2 ring-offset-4 ring-offset-[var(--card)] sm:size-36" />
        )}
        <SectionTitle id="about-title">{text(about.heading, DEFAULT_PAGES.about.heading)}</SectionTitle>
      </div>
      <div className="text-muted-foreground max-w-[60ch] space-y-4 text-[1.05rem] leading-relaxed">
        {paras.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </section>
  );
}

export function HowToBuy() {
  const { shop } = useStore();
  const buy = shop.pages?.buy || {};
  const steps = buy.steps && buy.steps.length ? buy.steps : DEFAULT_PAGES.buy.steps;
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} id="buy" aria-labelledby="buy-title" className="reveal mx-auto max-w-[1180px] py-14">
      <div className="text-center"><SectionTitle id="buy-title">{text(buy.heading, DEFAULT_PAGES.buy.heading)}</SectionTitle></div>
      <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((st, i) => (
          <li key={i} className="bg-card relative rounded-2xl border p-6 shadow-xs">
            <span className="bg-secondary text-primary font-display mb-4 grid size-10 place-items-center rounded-full text-lg">{i + 1}</span>
            <strong className="block font-medium">{st.title}</strong>
            <span className="text-muted-foreground mt-1.5 block text-[.95rem] leading-relaxed">{st.text}</span>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-center"><Button asChild variant="outline"><a href="#gallery">Start shopping</a></Button></p>
    </section>
  );
}

function CopyEmail({ email }: { email: string }) {
  const [copied, setCopied] = React.useState(false);
  const codeRef = React.useRef<HTMLElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(email); setCopied(true); }
    catch { const r = document.createRange(); if (codeRef.current) { r.selectNodeContents(codeRef.current); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); } }
    setTimeout(() => setCopied(false), 2200);
  };
  return (
    <div className="bg-card mx-auto mt-5 flex w-fit max-w-full items-center gap-2 rounded-full border py-1 pr-1 pl-4">
      <code ref={codeRef} className="truncate text-sm">{email}</code>
      <Button size="sm" variant="secondary" onClick={copy}>{copied ? <><Check /> Copied</> : <><Copy /> Copy</>}</Button>
    </div>
  );
}

export function Contact() {
  const { shop } = useStore();
  const a = shop.artist;
  const ig = igHandle(a);
  const contact = shop.pages?.contact || {};
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} id="contact" aria-labelledby="contact-title" className="reveal from-secondary/80 mx-auto mb-10 max-w-[1180px] rounded-[2rem] bg-gradient-to-b to-transparent px-6 py-14 text-center">
      <SectionTitle id="contact-title">{text(contact.heading, DEFAULT_PAGES.contact.heading)}</SectionTitle>
      <p className="text-muted-foreground mx-auto mt-3 max-w-[48ch]">{text(contact.text, DEFAULT_PAGES.contact.text)}</p>
      {(ig || a.email) && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {ig && <Button asChild size="lg"><a href={igUrl(a)} target="_blank" rel="noopener"><InstagramIcon /> Message @{ig}</a></Button>}
          {a.email && <Button asChild size="lg" variant="outline"><a href={mailto(a, "Painting enquiry")}>Email Sruthi</a></Button>}
        </div>
      )}
      {a.email && <CopyEmail email={a.email} />}
      {!a.email && !ig && <p className="text-muted-foreground mt-4">Contact details are on their way. Check back soon.</p>}
    </section>
  );
}

export function SiteFooter() {
  const { shop } = useStore();
  const ig = igHandle(shop.artist);
  return (
    <footer className="text-muted-foreground mx-auto max-w-[1180px] border-t py-8 text-center text-sm">
      <p>© {new Date().getFullYear()} Sruthi Arts. {text(shop.pages?.footer?.text, DEFAULT_PAGES.footer.text)}</p>
      <p className="mt-2">
        {ig && <><a className="text-primary underline-offset-4 hover:underline" href={igUrl(shop.artist)} target="_blank" rel="noopener">Instagram</a> · </>}
        <a className="text-primary underline-offset-4 hover:underline" href="admin/">Admin</a>
      </p>
    </footer>
  );
}

// Phone navigation: thumb-reachable tab bar that highlights the section in view.
export function TabBar() {
  const { shop } = useStore();
  const ig = igHandle(shop.artist);
  const [active, setActive] = React.useState("");
  React.useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) setActive(en.target.id); }), { rootMargin: "-45% 0px -50% 0px" });
    ["gallery", "about", "buy"].forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
    return () => io.disconnect();
  }, []);
  const item = "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground transition [&_svg]:size-[22px] data-[active=true]:text-primary";
  return (
    <nav aria-label="Quick links" className="bg-card/90 fixed inset-x-0 bottom-0 z-40 flex border-t px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden">
      <a href="#gallery" className={item} data-active={active === "gallery"}><LayoutGrid strokeWidth={1.6} /><span>Shop</span></a>
      <a href="#about" className={item} data-active={active === "about"}><UserRound strokeWidth={1.6} /><span>About</span></a>
      <a href="#buy" className={item} data-active={active === "buy"}><ShoppingBag strokeWidth={1.6} /><span>How to buy</span></a>
      <CartButton label className={cn(item, "[&>span:last-child]:top-0.5 [&>span:last-child]:right-[calc(50%-22px)]")} />
      {ig && <a href={igUrl(shop.artist)} target="_blank" rel="noopener" className={item}><InstagramIcon strokeWidth={1.6} /><span>Instagram</span></a>}
    </nav>
  );
}
