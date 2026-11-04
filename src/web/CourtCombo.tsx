import { useEffect, useRef, useState } from "preact/hooks";

/**
 * A court number: type it, or pick it from a dropdown of numbers 1..`list`. Typing narrows the list
 * to numbers that start with it. Used for 场号 in 球场排队 and for 预定场地 on the admin page.
 */
export function CourtCombo(props: {
  id: string;
  label: string;
  /** The label only for screen readers; the placeholder says it. */
  labelHidden?: boolean;
  placeholder: string;
  toggleLabel: string;
  value: string;
  onInput: (v: string) => void;
  /** Numbers in the dropdown; a higher one can still be typed, up to `max`. */
  list: number;
  max: number;
  /** Highlighted in the list (the one typed, or the ones already chosen). */
  isOn: (n: number) => boolean;
  /** Marked in the list, e.g. courts we already hold. */
  isMarked?: (n: number) => boolean;
  onPick: (n: number) => void;
  /** Leave the list open after a pick, to choose several. */
  multi?: boolean;
  /** Enter in the box. */
  onEnter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Closing on blur waits a moment: the list folding away would otherwise move a button tapped
  // below it (保存, 添加) out from under the finger before the tap lands.
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (on: boolean) => {
    clearTimeout(closing.current);
    setOpen(on);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  const all = Array.from({ length: props.list }, (_, i) => i + 1);
  const typed = props.value.trim();
  // A finished number shows them all again.
  const narrowed = all.filter((n) => String(n).startsWith(typed));
  const shown = typed && narrowed.some((n) => String(n) !== typed) ? narrowed : all;
  return (
    <div class="cq-court-no">
      <label for={props.id} class={props.labelHidden ? "sr-only" : "sheet-label"}>
        {props.label}
      </label>
      <div class="cq-combo">
        <input
          id={props.id}
          type="number"
          inputMode="numeric"
          min={1}
          max={props.max}
          placeholder={props.placeholder}
          value={props.value}
          onFocus={() => show(true)}
          onBlur={() => {
            clearTimeout(closing.current);
            closing.current = setTimeout(() => setOpen(false), 250);
          }}
          onInput={(ev) => {
            props.onInput((ev.target as HTMLInputElement).value);
            show(true);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && props.onEnter) {
              ev.preventDefault();
              props.onEnter();
            }
          }}
        />
        <button
          type="button"
          class="cq-combo-toggle"
          aria-label={props.toggleLabel}
          aria-expanded={open}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => show(!open)}
        >
          ▾
        </button>
      </div>
      {open && shown.length > 0 && (
        <div class="cq-court-list" role="listbox" aria-label={props.label} aria-multiselectable={props.multi}>
          {shown.map((n) => (
            <button
              type="button"
              role="option"
              key={n}
              aria-selected={props.isOn(n)}
              class={`${props.isOn(n) ? "on" : ""}${props.isMarked?.(n) ? " held" : ""}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => {
                props.onPick(n);
                if (!props.multi) show(false);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
