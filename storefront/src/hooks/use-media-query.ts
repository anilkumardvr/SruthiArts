import * as React from "react";

export function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(() => matchMedia(query).matches);
  React.useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export const useIsPhone = () => useMediaQuery("(max-width: 700px)");
