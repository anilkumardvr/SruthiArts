import * as React from "react";
import { Copy as CopyIcon } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { FadeImage } from "@/components/fade-image";
import { categoriesOf, igHandle, igUrl, isAuction, isSold, photosOf, reduceMotion, spec, stockLabel } from "@/lib/shop";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

export function Gallery() {
  const { shop, money, openPiece } = useStore();
  const [filter, setFilter] = React.useState("all");
  // Auction pieces are shown in the Auctions section instead.
  const ps = shop.paintings.filter((p) => !isAuction(p));
  const count = (id: string) => (id === "all" ? ps.length : ps.filter((p) => p.category === id).length);
  // "All" plus every category that has something in it; an empty category's button is hidden.
  const categories = [{ id: "all", label: "All" }, ...categoriesOf(shop.artist).filter((c) => count(c.id) > 0)];
  React.useEffect(() => { if (filter !== "all" && !count(filter)) setFilter("all"); }); // its last piece was removed
  const list = shop.paintings.map((p, idx) => ({ p, idx })).filter(({ p }) => !isAuction(p) && (filter === "all" || p.category === filter));
  const ig = igHandle(shop.artist);

  // Framed pieces lean toward the cursor.
  const lean = (e: React.PointerEvent<HTMLElement>) => {
    if (reduceMotion() || e.pointerType !== "mouse") return;
    const f = e.currentTarget;
    const r = f.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    f.style.transform = `perspective(700px) translateY(-4px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg)`;
  };

  return (
    <section id="gallery" aria-labelledby="gallery-title" className="mx-auto max-w-[1180px] scroll-mt-16 py-6">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="gallery-title" className="text-[2.2rem] leading-none">Shop</h2>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v)}
          aria-label="Filter by category"
          variant="outline"
          className="no-scrollbar -mx-4 w-auto max-w-[100vw] overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
        >
          {categories.map((c) => (
            <ToggleGroupItem
              key={c.id}
              value={c.id}
              onClick={(e) => e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" })}
              className="group gap-1.5"
            >
              {c.label}
              <span className="bg-secondary text-secondary-foreground group-data-[state=on]:bg-primary-foreground/20 group-data-[state=on]:text-primary-foreground rounded-full px-1.5 text-[11px] leading-[18px] tabular-nums">{count(c.id)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <ul key={filter} aria-live="polite" className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-7 sm:gap-y-12 md:grid-cols-3 lg:grid-cols-4">
        {!list.length && (
          <li className="text-muted-foreground col-span-full rounded-2xl border border-dashed p-10 text-center">
            <p>No {filter === "all" ? "pieces" : (categories.find((c) => c.id === filter)?.label || "pieces").toLowerCase()} listed right now.</p>
            {ig && <p className="mt-1"><a className="text-primary underline underline-offset-4" href={igUrl(shop.artist)} target="_blank" rel="noopener">Follow @{ig}</a> for new pieces, or message to ask about one.</p>}
          </li>
        )}
        {list.map(({ p, idx }, i) => {
          const sold = isSold(p);
          const n = photosOf(p).length;
          return (
            <li key={p.id} className="card-in" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
              <button type="button" onClick={() => openPiece(idx)} aria-label={`View ${p.title}, ${stockLabel(p)}`} className="group block w-full cursor-pointer text-left outline-none">
                <div onPointerMove={lean} onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
                  className={cn("frame relative rounded-sm group-focus-visible:ring-ring group-focus-visible:ring-[3px]", sold && "opacity-80 saturate-[.7]")}>
                  <FadeImage src={p.image} alt={p.alt || p.title} loading={i < 4 ? "eager" : "lazy"} width={800} height={1000} />
                  {n > 1 && (
                    <span title={`${n} photos`} className="bg-card/90 text-foreground absolute top-[9%] right-[9%] grid size-7 place-items-center rounded-full shadow-sm">
                      <CopyIcon className="size-3.5" aria-hidden="true" /><span className="sr-only">{n} photos</span>
                    </span>
                  )}
                  {sold && <span className="bg-plum/85 absolute top-[9%] left-[9%] rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-[0.12em] text-white uppercase">Sold</span>}
                </div>
              </button>
              <div className="mt-4 px-0.5">
                <h3 className="font-display text-[1.1rem] leading-snug sm:text-[1.2rem]">{p.title}</h3>
                {spec(p) && <p className="text-muted-foreground mt-0.5 text-[13px]">{spec(p)}</p>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-primary font-medium">{sold ? "—" : money(p.price)}</span>
                  <Badge variant={sold ? "muted" : "success"}>{stockLabel(p)}</Badge>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
