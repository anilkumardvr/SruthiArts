import * as React from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Quantity − n + control.
export function Stepper({ value, min, max, onChange, label, className }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; className?: string }) {
  const [bump, setBump] = React.useState(0);
  const set = (d: number) => {
    const v = Math.max(min, Math.min(max, value + d));
    if (v === value) return;
    setBump((b) => b + 1);
    onChange(v);
  };
  return (
    <div className={cn("bg-card inline-flex items-center rounded-full border p-0.5 shadow-xs", className)}>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`One fewer ${label}`} disabled={value <= min} onClick={() => set(-1)}><Minus /></Button>
      <output key={bump} className={cn("min-w-7 text-center text-sm font-medium tabular-nums", bump > 0 && "bump")}>{value}</output>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`One more ${label}`} disabled={value >= max} onClick={() => set(1)}><Plus /></Button>
    </div>
  );
}
