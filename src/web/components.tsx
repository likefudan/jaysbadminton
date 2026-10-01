import type { ComponentChildren } from "preact";
import type { Loaded } from "./hooks";

export function Page(props: { title: string; children: ComponentChildren }) {
  return (
    <div class="page">
      <header class="topbar">
        <a href="/" class="brand">
          🏸 Jay's 羽毛球
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
