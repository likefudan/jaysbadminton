import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Loaded } from "./hooks";
import { AppearanceButton, AppearanceSheet } from "./Appearance";
import { useSiteTitle } from "./site";
import { GoogleAccount } from "./GoogleAccount";

export function Page(props: { title: string; eyebrow?: string; subtitle?: string; children: ComponentChildren }) {
  const site = useSiteTitle();
  const [looks, setLooks] = useState(false);
  useEffect(() => {
    document.title = props.title === site ? site : `${props.title} · ${site}`;
  }, [props.title, site]);
  return (
    <div class="page">
      <header class="topbar">
        <a href="/" class="brand">
          <span class="logo">
            <RacketMark />
          </span>
          <span class="brand-name">{site}</span>
        </a>
        <div class="topbar-actions">
          <GoogleAccount />
          <AppearanceButton onClick={() => setLooks(true)} />
        </div>
      </header>
      {looks && <AppearanceSheet onClose={() => setLooks(false)} />}
      <main>
        <div class="hero">
          {props.eyebrow && <p class="eyebrow">{props.eyebrow}</p>}
          <h1>{props.title}</h1>
          {props.subtitle && <p class="subtitle">{props.subtitle}</p>}
        </div>
        {props.children}
      </main>
      <footer class="legal-links">
        <a href="/privacy">隐私政策</a>
        <span aria-hidden="true">·</span>
        <a href="/terms">使用条款</a>
      </footer>
    </div>
  );
}

/** The app icon's racket and swing, in the current accent colour. */
function RacketMark() {
  return (
    <svg viewBox="0 0 512 512" width="22" height="22" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-linecap="round">
        <path d="M84 300 A220 220 0 0 1 160 92" stroke-width="26" opacity=".4" />
      </g>
      <g transform="translate(262 262) scale(1.28) rotate(38)" fill="none" stroke="currentColor">
        <ellipse rx="62" ry="84" stroke-width="28" />
        <path d="M-40 -60V60M0 -80V80M40 -60V60M-56 -30H56M-60 10H60M-50 50H50" stroke-width="7" opacity=".7" />
        <path d="M-16 80 L0 112 L16 80" stroke-width="12" stroke-linejoin="round" />
        <path d="M0 112V166" stroke-width="20" stroke-linecap="round" />
        <path d="M0 176V220" stroke-width="36" stroke-linecap="round" />
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

export interface Tile {
  label: string;
  value: ComponentChildren;
  unit?: string;
  sub?: string;
}

/** Big numbers in a row (3) or a 2×2 grid (4); the first one is the headline. */
export function Tiles(props: { items: Tile[] }) {
  return (
    <div class={`tiles tiles-${props.items.length}`}>
      {props.items.map((t, i) => (
        <div key={t.label} class={i === 0 ? "tile lead" : "tile"}>
          <span class="tile-label">{t.label}</span>
          <span class="tile-value">
            {t.value}
            {t.unit && <small>{t.unit}</small>}
          </span>
          {t.sub && <span class="tile-sub">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <p class="empty">{props.children}</p>;
}

export function Load<T>(props: { result: Loaded<T>; children: (data: T) => ComponentChildren }) {
  const r = props.result;
  if (r.state === "loading") return <p class="muted">加载中…</p>;
  if (r.state === "error") return <p class="error">{r.message}</p>;
  return <>{props.children(r.data)}</>;
}

export function Field(props: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  type?: string;
  hint?: string;
  autocomplete?: string;
}) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        autocomplete={props.autocomplete}
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
  return { busy, error, run, setError };
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
      {done ? "已复制" : (props.label ?? "复制")}
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
      {qr && <img class="qr" src={qr} alt="二维码" />}
      <p class="muted small">长按二维码可保存图片</p>
      <code class="link">{props.link}</code>
      <CopyButton text={props.link} label="复制链接" />
    </div>
  );
}
