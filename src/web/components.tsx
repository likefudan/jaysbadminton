import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Loaded } from "./hooks";
import { useSiteTitle } from "./site";

export function Page(props: { title: string; children: ComponentChildren }) {
  const site = useSiteTitle();
  useEffect(() => {
    document.title = props.title === site ? site : `${props.title} · ${site}`;
  }, [props.title, site]);
  return (
    <div class="page">
      <header class="topbar">
        <a href="/" class="brand">
          🏸 {site}
        </a>
      </header>
      <main>
        <h1>{props.title}</h1>
        {props.children}
      </main>
    </div>
  );
}

export function Card(props: { title?: string; children: ComponentChildren }) {
  return (
    <section class="card">
      {props.title && <h2>{props.title}</h2>}
      {props.children}
    </section>
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
