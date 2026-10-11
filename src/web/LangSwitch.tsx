import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { LANGS, setLang, t, useLang } from "./i18n";

/** The language button in the top bar: a 文A icon, the same in every language, opening a short menu of the three. */
export function LangSwitch() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const now = LANGS.find((l) => l.id === lang)!;
  return (
    <div class="lang-switch" ref={box}>
      <button
        type="button"
        class="lang-btn"
        aria-label={t("语言：{name}", { name: now.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
          <text x="1" y="13" font-size="12" font-weight="600">
            文
          </text>
          <text x="12.5" y="21.5" font-size="12" font-weight="700" font-family="var(--font)">
            A
          </text>
        </svg>
      </button>
      {open && (
        <div class="lang-menu" role="menu">
          {LANGS.map((l) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={l.id === lang}
              key={l.id}
              class={l.id === lang ? "on" : ""}
              lang={l.id}
              onClick={() => {
                setOpen(false);
                setLang(l.id);
              }}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
