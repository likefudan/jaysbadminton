import type { AccessibleInputHTMLAttributes, ComponentChildren, HTMLInputTypeAttribute } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Loaded } from "./hooks";
import { AppearanceButton, AppearanceSheet } from "./Appearance";
import { useSiteTitle, useStaging } from "./site";
import { DeveloperSwitch } from "./DeveloperTools";
import { GoogleAccount } from "./GoogleAccount";
import { useLocation } from "preact-iso";
import { isAdminPath, t, tm } from "./i18n";
import { LangSwitch } from "./LangSwitch";

export function Page(props: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** No big title on the page itself (the home page: the top bar already names the site). */
  bare?: boolean;
  children: ComponentChildren;
}) {
  const site = useSiteTitle();
  const staging = useStaging();
  const [looks, setLooks] = useState(false);
  const { path } = useLocation();
  const admin = isAdminPath(path);
  useEffect(() => {
    document.title = props.title === site ? site : `${props.title} · ${site}`;
  }, [props.title, site]);
  return (
    <div class="page">
      {staging && <div class="env-banner">{t("测试环境 · 数据和正式网站分开，请不要转发这里的链接")}</div>}
      <header class="topbar">
        <a href="/" class="brand">
          <span class={staging ? "logo logo-staging" : "logo"}>
            <BridgeMark />
          </span>
          <span class="brand-name">{site}</span>
        </a>
        <div class="topbar-actions">
          <GoogleAccount />
          {!admin && <LangSwitch />}
          <AppearanceButton onClick={() => setLooks(true)} />
        </div>
      </header>
      {looks && <AppearanceSheet onClose={() => setLooks(false)} />}
      <main>
        {props.bare ? (
          <h1 class="sr-only">{props.title}</h1>
        ) : (
          <div class="hero">
            {props.eyebrow && <p class="eyebrow">{props.eyebrow}</p>}
            <h1>{props.title}</h1>
            {props.subtitle && <p class="subtitle">{props.subtitle}</p>}
          </div>
        )}
        {props.children}
      </main>
      {staging && <DeveloperSwitch />}
      <footer class="legal-links">
        <a href="/privacy">{t("隐私政策")}</a>
        <span aria-hidden="true">·</span>
        <a href="/terms">{t("使用条款")}</a>
      </footer>
    </div>
  );
}

/** The app icon's Golden Gate towers, main cable, deck and shuttlecock, simplified, in the current accent colour. */
function BridgeMark() {
  return (
    <svg viewBox="0 0 512 512" width="22" height="22" aria-hidden="true" fill="currentColor">
      <path
        d="M0 300 Q70 210 132 120 Q256 420 380 120 Q442 210 512 300"
        fill="none"
        stroke="currentColor"
        stroke-width="30"
        stroke-linejoin="round"
      />
      <path d="M99 92L119 92L110 470L90 470ZM165 92L145 92L154 470L174 470Z" />
      <path d="M347 92L367 92L358 470L338 470ZM413 92L393 92L402 470L422 470Z" />
      <rect x="99" y="92" width="66" height="20" />
      <rect x="98" y="141" width="68" height="14" />
      <rect x="97" y="194" width="71" height="14" />
      <rect x="95" y="255" width="73" height="14" />
      <rect x="103" y="74" width="12" height="20" />
      <rect x="149" y="74" width="12" height="20" />
      <rect x="347" y="92" width="66" height="20" />
      <rect x="346" y="141" width="68" height="14" />
      <rect x="345" y="194" width="71" height="14" />
      <rect x="343" y="255" width="73" height="14" />
      <rect x="351" y="74" width="12" height="20" />
      <rect x="397" y="74" width="12" height="20" />
      <rect x="0" y="356" width="512" height="34" />
      <g transform="translate(256 140) scale(.82)">
        <path d="M-26 22 L-66 -78 Q-50 -94 -33 -80 Q-16 -96 0 -82 Q16 -96 33 -80 Q50 -94 66 -78 L26 22 Z" />
        <path d="M-30 30 H30 V40 A30 30 0 0 1 -30 40 Z" />
      </g>
    </svg>
  );
}

export function Card(props: { title?: string; class?: string; children: ComponentChildren }) {
  return (
    <section class={props.class ? `card ${props.class}` : "card"}>
      {props.title && <h2>{props.title}</h2>}
      {props.children}
    </section>
  );
}

/** A heading above a group of cards, with an optional link on the right. */
export function SectionTitle(props: { children: ComponentChildren; more?: ComponentChildren }) {
  return (
    <h2 class="section-title">
      <span>{props.children}</span>
      {props.more}
    </h2>
  );
}

/**
 * One line of a settings list (个人信息): icon, label, its value on the right and a chevron. A link
 * with href; otherwise a button that runs onClick, or opens its panel underneath (which gets a
 * close() for after saving).
 */
export function SettingRow(props: {
  icon: ComponentChildren;
  label: string;
  value?: ComponentChildren;
  href?: string;
  onClick?: () => void;
  panel?: (close: () => void) => ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const inner = (
    <>
      <span class="set-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span class="set-label">{props.label}</span>
      <span class="set-value">{props.value}</span>
      <svg class={open ? "set-chev open" : "set-chev"} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </>
  );
  return (
    <div class="set-item">
      {props.href ? (
        <a class="set-row" href={props.href}>
          {inner}
        </a>
      ) : (
        <button
          type="button"
          class="set-row"
          aria-expanded={props.panel ? open : undefined}
          onClick={props.onClick ?? (() => setOpen(!open))}
        >
          {inner}
        </button>
      )}
      {open && props.panel && <div class="set-panel">{props.panel(() => setOpen(false))}</div>}
    </div>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <p class="empty">{props.children}</p>;
}

export function Load<T>(props: { result: Loaded<T>; children: (data: T) => ComponentChildren }) {
  const r = props.result;
  if (r.state === "loading") return <p class="muted">{t("加载中…")}</p>;
  if (r.state === "error") return <p class="error">{tm(r.message)}</p>;
  return <>{props.children(r.data)}</>;
}

export function Field(props: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  type?: HTMLInputTypeAttribute;
  hint?: string;
  autocomplete?: string;
  /** Typed exactly as is (usernames, passwords): no capital first letter or autocorrect on phones. */
  verbatim?: boolean;
}) {
  const verbatim = props.verbatim ? ({ autocapitalize: "none", autocorrect: "off", spellcheck: false } as const) : {};
  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        // Preact 11 types <input> as a union keyed on `type`, which a variable `type` can't satisfy.
        {...({ type: props.type ?? "text" } as AccessibleInputHTMLAttributes)}
        value={props.value}
        autocomplete={props.autocomplete}
        {...verbatim}
        onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
      />
      {props.hint && <small class="muted">{props.hint}</small>}
    </label>
  );
}

/** Runs an async action with a busy flag and a user-facing error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error: tm(error), run, setError };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // WeChat's browser often blocks the clipboard API; fall back to a selected textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton(props: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      class="button secondary"
      type="button"
      onClick={async () => {
        if (await copyText(props.text)) {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }
      }}
    >
      {done ? t("已复制") : (props.label ?? t("复制"))}
    </button>
  );
}

/** A link plus its QR code, for sending to someone over WeChat. */
export function LinkCard(props: { title: string; link: string; note?: string }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    // Loaded on demand: only the admin pages show QR codes.
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(props.link, { width: 480, margin: 1 }))
      .then(setQr, () => setQr(""));
  }, [props.link]);
  return (
    <div class="linkcard">
      <strong>{props.title}</strong>
      {props.note && <p class="muted">{props.note}</p>}
      {qr && <img class="qr" src={qr} alt={t("二维码")} />}
      <p class="muted small">{t("长按二维码可保存图片")}</p>
      <code class="link">{props.link}</code>
      <CopyButton text={props.link} label={t("复制链接")} />
    </div>
  );
}
