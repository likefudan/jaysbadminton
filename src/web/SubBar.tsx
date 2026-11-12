import { useLayoutEffect } from "preact/hooks";
import { useWide } from "./hooks";

/**
 * The top bar of a page one level down on the 管理页 (event, 新建活动, member, the 设置 sub-pages):
 * 「‹ 上一级」, the page's name in the middle, the same look as a full-screen panel's bar
 * (Ke Li 2026-11-11, option B). While it shows, the site's top bar and the tabs are hidden, so the
 * page reads as a page of its own; going back (adminNav.ts) brings them back. On a wide screen the
 * page sits in the right half beside its list (MasterDetail.tsx), so the top bar and the tabs stay.
 */
export function SubBar(props: { back: () => void; label: string; title?: string }) {
  const wide = useWide();
  useLayoutEffect(() => {
    if (wide) return;
    document.documentElement.classList.add("sub-open");
    return () => document.documentElement.classList.remove("sub-open");
  }, [wide]);
  return (
    <div class="sub-bar">
      <button type="button" class="panel-back" onClick={props.back}>
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
        {props.label}
      </button>
      {props.title ? <h2 class="sub-bar-title">{props.title}</h2> : <span />}
      <span />
    </div>
  );
}
