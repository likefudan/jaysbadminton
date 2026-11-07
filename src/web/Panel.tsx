import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";
import { t } from "./i18n";

/** How far from the left edge a swipe must start, and how far right it must go, to go back. */
const EDGE_PX = 32;
const BACK_PX = 80;

/** The panels open now, the last on top (账号管理 opens over 登记球场). */
const stack: object[] = [];

/** True while a panel covers the page (下拉刷新 leaves its touches alone). */
export const panelOpen = () => stack.length > 0;

/**
 * A full-screen panel over the page (Ke Li 2026-11-06, option D): a top bar with 「‹ 返回」, the
 * title and an optional action on the right; the rest scrolls under it. Earlier these were bottom
 * sheets sized in vh, whose ✕ went under Safari's address bar on small phones.
 *
 * Going back: 返回, Esc, the browser's back (Android's back button, Safari's edge swipe) through a
 * history entry of its own, or a swipe right from the left edge (the home-screen app has no
 * browser swipe). On a wide screen it is a centred card instead, and a click outside closes it.
 */
export function Panel(props: {
  title: ComponentChildren;
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  /** A button on the right of the top bar. */
  action?: ComponentChildren;
  class?: string;
  children: ComponentChildren;
}) {
  const close = useRef(props.onClose);
  close.current = props.onClose;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const me = {};
    stack.push(me);
    document.documentElement.classList.add("panel-open");
    // Esc closes only the panel on top.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stack[stack.length - 1] === me && close.current();
    addEventListener("keydown", onKey);
    // An entry of our own, so the browser's back closes the panel instead of leaving the page.
    const mark = `panel-${Date.now()}-${Math.random()}`;
    history.pushState({ ...(history.state ?? {}), panel: mark }, "");
    let popped = false;
    const onPop = () => {
      if (history.state?.panel === mark) return; // a panel opened over this one went back
      popped = true;
      close.current();
    };
    addEventListener("popstate", onPop);
    return () => {
      stack.splice(stack.indexOf(me), 1);
      if (!stack.length) document.documentElement.classList.remove("panel-open");
      removeEventListener("keydown", onKey);
      removeEventListener("popstate", onPop);
      // Closed with 返回 or Esc: take our entry off again. Not if a link inside moved on.
      if (!popped && history.state?.panel === mark) history.back();
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let x0: number | null = null;
    let y0 = 0;
    let dx = 0;
    let sideways = false;
    const start = (e: TouchEvent) => {
      const p = e.touches[0];
      x0 = e.touches.length === 1 && p && p.clientX - el.getBoundingClientRect().left <= EDGE_PX ? p.clientX : null;
      y0 = p?.clientY ?? 0;
      dx = 0;
      sideways = false;
    };
    const move = (e: TouchEvent) => {
      const p = e.touches[0];
      if (x0 === null || !p) return;
      dx = Math.max(0, p.clientX - x0);
      if (!sideways && Math.abs(p.clientY - y0) > dx) {
        x0 = null; // scrolling, not going back
        return;
      }
      sideways = true;
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`;
    };
    const end = () => {
      if (x0 === null) return;
      x0 = null;
      el.style.transition = "";
      if (dx >= BACK_PX) {
        el.style.transform = "translateX(100%)";
        setTimeout(() => close.current(), 160);
      } else el.style.transform = "";
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);

  // Into <body>: event cards use backdrop-filter, which would trap a fixed panel inside the card.
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside (wide screens) is a mouse shortcut; Esc and 返回 close it too
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
    <div class="panel-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={box} class={props.class ? `panel ${props.class}` : "panel"} role="dialog" aria-label={props.label}>
        <div class="panel-bar">
          <button type="button" class="panel-back" onClick={props.onClose}>
            <svg viewBox="0 0 12 20" width="11" height="18" aria-hidden="true">
              <path
                d="M10 2L2 10l8 8"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {t("返回")}
          </button>
          <strong class="panel-title">{props.title}</strong>
          <span class="panel-action">{props.action}</span>
        </div>
        <div class="panel-body">{props.children}</div>
      </div>
    </div>,
    document.body,
  );
}
