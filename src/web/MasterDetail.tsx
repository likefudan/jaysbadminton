import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { useWide } from "./hooks";

/**
 * A list and the page one opens from it (管理页: 活动, 成员, 设置).
 *
 * On a phone the opened page takes the screen and the list waits underneath, hidden, so coming
 * back finds it as it was. On a wide screen (an unfolded iPhone Duo, a tablet, a computer) the
 * list keeps the left half and the opened page shows in the right half (Ke Li 2026-11-12).
 * The same elements either way, so folding the phone doesn't lose what was typed.
 */
export function MasterDetail(props: {
  /** The opened page, or null for none. */
  detail: ComponentChildren;
  /** What the right half says while nothing is open. */
  empty: string;
  /** The list. */
  children: ComponentChildren;
}) {
  const wide = useWide();
  const open = !!props.detail;
  // Kept once seen; not drawn on a phone for a page opened straight from a link or a push.
  const seen = useRef(false);
  if (!open || wide) seen.current = true;
  return (
    <div class="md">
      <div class="md-detail">{open ? props.detail : wide && <p class="md-empty">{props.empty}</p>}</div>
      {seen.current && (
        <div class="md-list flow" hidden={open && !wide}>
          {props.children}
        </div>
      )}
    </div>
  );
}
