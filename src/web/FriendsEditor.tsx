import { Field } from "./components";
import { t } from "./i18n";

/** A +/- counter for friends with an optional name for each. */
export function FriendsEditor(props: {
  friends: string[];
  max: number | null;
  onChange: (f: string[]) => void;
  label?: string;
}) {
  const f = props.friends;
  const set = (i: number, v: string) => props.onChange(f.map((x, j) => (j === i ? v : x)));
  return (
    <div class="friends-editor">
      <div class="friends-row">
        <div class="friends-label">
          <span>{props.label ?? t("带朋友")}</span>
          {props.max !== null && <small class="muted">{t("最多 {n} 个朋友", { n: props.max })}</small>}
        </div>
        <div class="stepper">
          <button
            type="button"
            disabled={f.length === 0}
            onClick={() => props.onChange(f.slice(0, -1))}
            aria-label={t("少一个")}
          >
            −
          </button>
          <output>{f.length}</output>
          <button
            type="button"
            disabled={props.max !== null && f.length >= props.max}
            onClick={() => props.onChange([...f, ""])}
            aria-label={t("多一个")}
          >
            +
          </button>
        </div>
      </div>
      {f.map((name, i) => (
        <Field key={i} label={t("朋友 {n} 的名字（选填）", { n: i + 1 })} value={name} onInput={(v) => set(i, v)} />
      ))}
    </div>
  );
}
