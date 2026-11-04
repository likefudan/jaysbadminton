import { useEffect, useRef, useState } from "preact/hooks";
import { currentLang, t } from "./i18n";
import { useTurnstileSiteKey } from "./site";

/** What api.js puts on window (only the calls used here). */
interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      action: string;
      language: string;
      theme: "auto";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let script: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once, for explicit rendering (the forms are drawn after page load). */
function loadScript(): Promise<TurnstileApi> {
  script ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    el.async = true;
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    el.onerror = () => {
      script = null; // try again next time a form opens
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(el);
  });
  return script;
}

const LANGUAGE = { "zh-CN": "zh-cn", "zh-TW": "zh-tw", en: "en" } as const;

/**
 * Cloudflare Turnstile (人机验证) for a public form. `widget` goes inside the form and `field` in the
 * request body; `check()` gives the message to show while it isn't solved yet (null when it is, or
 * when Turnstile is off); `reset()` after every submission, since a token works once.
 */
export function useTurnstile(action: "recover_link") {
  const siteKey = useTurnstileSiteKey();
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    loadScript()
      .then((ts) => {
        if (gone || !box.current) return;
        id.current = ts.render(box.current, {
          sitekey: siteKey,
          action,
          language: LANGUAGE[currentLang()],
          theme: "auto",
          callback: (tk) => {
            setToken(tk);
            setFailed(false);
          },
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setFailed(true);
          },
        });
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, [siteKey, action]);

  return {
    /** Spread into the request body; nothing while Turnstile is off. */
    field: token ? { turnstileToken: token } : {},
    widget: siteKey ? <div class="turnstile" ref={box} /> : null,
    check(): string | null {
      if (siteKey === undefined) return t("页面还在加载，请稍等一下再提交");
      if (!siteKey || token) return null;
      return failed ? t("人机验证加载失败，请刷新页面再试") : t("请先完成人机验证");
    },
    reset() {
      setToken("");
      if (id.current) window.turnstile?.reset(id.current);
    },
  };
}
