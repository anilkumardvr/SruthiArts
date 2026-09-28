import * as React from "react";

import { cn } from "@/lib/utils";

// Images fade in once decoded; a failed image shows the mat instead of a broken icon.
export function FadeImage({ className, onLoad, onError, ...props }: React.ComponentProps<"img">) {
  const [state, setState] = React.useState<"loading" | "loaded" | "broken">("loading");
  const ref = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    setState("loading");
    const img = ref.current;
    if (img && img.complete && img.naturalWidth) setState("loaded");
  }, [props.src]);
  return (
    <img
      ref={ref}
      decoding="async"
      className={cn("fade-img", state !== "loading" && "is-loaded", state === "broken" && "invisible", className)}
      onLoad={(e) => { setState("loaded"); onLoad?.(e); }}
      onError={(e) => { setState("broken"); onError?.(e); }}
      {...props}
    />
  );
}
