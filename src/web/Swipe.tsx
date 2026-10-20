import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "./i18n";

/**
 * A heading over a row of small cards that scrolls sideways. Fingers and trackpads scroll it
 * natively; with a mouse, ‹ › beside the heading turn a page and the row can be dragged
 * (Ke Li's pick for desktop). The arrows show only with a fine pointer, and only when the row overflows.
 */
export function SwipeSection(props: {
  title: ComponentChildren;
  /** Shown beside the arrows, e.g. the leaderboard's tabs. */
  extra?: ComponentChildren;
  /** Shown instead of the row, with no arrows, when there is nothing to list. */
  empty?: ComponentChildren;
  ordered?: boolean;
  class?: string;
  children?: ComponentChildren;
}) {
  const row = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const moved = useRef(false);

  function measure() {
    const el = row.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }
  useEffect(() => {
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  });

  function page(dir: 1 | -1) {
    const el = row.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  }

  function drag(e: PointerEvent) {
    const el = row.current;
    if (!el || e.pointerType !== "mouse" || e.button !== 0) return;
    const x0 = e.clientX;
    const left0 = el.scrollLeft;
    moved.current = false;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - x0;
      if (!moved.current && Math.abs(dx) < 5) return;
      if (!moved.current) {
        moved.current = true;
        el.classList.add("dragging");
      }
      el.scrollLeft = left0 - dx;
    };
    const up = () => {
      el.classList.remove("dragging");
      // The click that follows this pointerup (if any) is swallowed below; forget the drag after it.
      setTimeout(() => {
        moved.current = false;
      });
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  const Row = props.ordered ? "ol" : "div";
  const arrows = !props.empty && !(edges.start && edges.end);
  return (
    <>
      <h2 class="section-title with-seg">
        <span>{props.title}</span>
        {(props.extra || arrows) && (
          <span class="swipe-tools">
            {props.extra}
            {arrows && (
              <span class="swipe-arrows">
                <button type="button" aria-label={t("上一页")} disabled={edges.start} onClick={() => page(-1)}>
                  ‹
                </button>
                <button type="button" aria-label={t("下一页")} disabled={edges.end} onClick={() => page(1)}>
                  ›
                </button>
              </span>
            )}
          </span>
        )}
      </h2>
      {props.empty ?? (
        <Row
          ref={row as never}
          class={props.class ? `swipe ${props.class}` : "swipe"}
          onScroll={measure}
          onPointerDown={drag}
          onDragStart={(e) => e.preventDefault()}
          onClickCapture={(e) => {
            // A drag that ends on a card isn't a tap on it.
            if (moved.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {props.children}
        </Row>
      )}
    </>
  );
}
