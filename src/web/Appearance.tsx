import { useEffect } from "preact/hooks";
import { STYLES, themeById, type ThemeId } from "../shared/themes";
import { setMyMode, setMyTheme, useAppearance, type Mode } from "./site";
import { t, tk } from "./i18n";

const MODES: { id: Mode; label: string }[] = [
  { id: "auto", label: tk("自动") },
  { id: "light", label: tk("浅色") },
  { id: "dark", label: tk("深色") },
];

/** The 「外观」 button in the top bar. */
export function AppearanceButton(props: { onClick: () => void }) {
  return (
    <button type="button" class="appearance-btn" aria-label={t("外观")} onClick={props.onClick}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
      </svg>
    </button>
  );
}

/**
 * Its sheet. Rendered outside the top bar: the bar's backdrop-filter would otherwise become the
 * containing block of this position: fixed overlay. Choices stay on this phone only.
 */
export function AppearanceSheet(props: { onClose: () => void }) {
  const a = useAppearance();
  const now = themeById(a.mine ?? a.site);
  const style = STYLES.find((s) => s.id === now.style)!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // Switching style keeps the accent in the same position (珊瑚橙 ↔ 紫青, 海蓝 ↔ 日落 …).
  function pickStyle(id: string) {
    const s = STYLES.find((x) => x.id === id)!;
    const i = Math.max(
      0,
      style.accents.findIndex((x) => x.id === now.accent),
    );
    setMyTheme(`${s.id}-${s.accents[i]!.id}` as ThemeId);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside is a mouse shortcut; Esc and ✕ close it too
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-label={t("外观")}>
        <div class="sheet-head">
          <strong>{t("外观")}</strong>
          <button type="button" class="sheet-close" aria-label={t("关闭")} onClick={props.onClose}>
            ✕
          </button>
        </div>
        <p class="sheet-label">{t("风格")}</p>
        <div class="seg">
          {STYLES.map((s) => (
            <button type="button" key={s.id} class={s.id === now.style ? "on" : ""} onClick={() => pickStyle(s.id)}>
              {t(s.name)}
            </button>
          ))}
        </div>
        <p class="sheet-label">{t("强调色")}</p>
        <div class="accents">
          {style.accents.map((x) => (
            <button
              type="button"
              key={x.id}
              class={x.id === now.accent ? "accent-pick on" : "accent-pick"}
              onClick={() => setMyTheme(`${style.id}-${x.id}` as ThemeId)}
            >
              <i style={{ background: `linear-gradient(135deg, ${x.swatch[0]}, ${x.swatch[1]})` }} />
              {t(x.name)}
            </button>
          ))}
        </div>
        <p class="sheet-label">{t("模式")}</p>
        <div class="seg">
          {MODES.map((m) => (
            <button type="button" key={m.id} class={m.id === a.mode ? "on" : ""} onClick={() => setMyMode(m.id)}>
              {t(m.label)}
            </button>
          ))}
        </div>
        <p class="muted small sheet-note">
          {t("只对这台手机生效。")}
          {a.mine && (
            <button type="button" class="text-button" onClick={() => setMyTheme(null)}>
              {t("恢复网站默认")}
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
