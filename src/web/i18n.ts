import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LANG_KEY, activate, chosenLang, isLang, listeners, lookup, setLang, type Lang } from "./lang";

export * from "./lang";

// A choice made in another tab of this browser.
addEventListener("storage", (e) => {
  if (e.key === LANG_KEY && isLang(e.newValue) && e.newValue !== chosenLang()) setLang(e.newValue, false);
});

/** The visitor's choice, for the switch. */
export function useLang(): Lang {
  const [l, setL] = useState(chosenLang);
  useEffect(() => {
    listeners.add(setL);
    setL(chosenLang()); // in case it changed between render and now
    return () => void listeners.delete(setL);
  }, []);
  return l;
}

/** Sets the language the page renders in (main.tsx, before rendering the page). */
export function useActiveLang(admin: boolean): Lang {
  const lang = useLang();
  return activate(admin ? "zh-CN" : lang);
}

/** Like t(), for placeholders that are elements (a <strong>, a link). */
export function tx(zh: string, vars: Record<string, ComponentChildren>): ComponentChildren[] {
  return lookup(zh)
    .split(/(\{\w+\})/)
    .map((part) => {
      const k = /^\{(\w+)\}$/.exec(part)?.[1];
      return k && k in vars ? vars[k] : part;
    });
}
