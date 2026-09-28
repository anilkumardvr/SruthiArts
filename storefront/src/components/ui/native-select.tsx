import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// shadcn/ui NativeSelect: a styled <select>. Native menus suit long lists (countries) and phone keyboards.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative w-full" data-slot="native-select-wrapper">
      <select
        data-slot="native-select"
        className={cn(
          "border-input h-11 w-full min-w-0 appearance-none rounded-xl border bg-card py-1 pr-9 pl-3.5 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px]",
          "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
          className
        )}
        {...props}
      />
      <ChevronDownIcon className="text-muted-foreground pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 select-none" aria-hidden="true" />
    </div>
  );
}

export { NativeSelect };
