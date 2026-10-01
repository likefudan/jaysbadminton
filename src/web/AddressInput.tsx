import { useEffect, useRef, useState } from "preact/hooks";
import type { AddressSuggestion } from "../shared/types";
import { api } from "./api";

const newSession = () =>
  typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();

/**
 * US address field with suggestions as you type, Northern California first. Lookups go through
 * our server (Google Places when configured, otherwise Photon). Picking a business also offers
 * its name, so a new venue can be filled from one search.
 */
export function AddressInput(props: {
  base: string; // /api/admin/<token>
  value: string;
  onInput: (v: string) => void;
  onPlace?: (name: string) => void;
}) {
  const [list, setList] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const typed = useRef(false);
  // One Google billing session per address picked: keystrokes plus the final lookup.
  const session = useRef(newSession());
  const cache = useRef(new Map<string, AddressSuggestion[]>());

  useEffect(() => {
    const q = props.value.trim();
    if (!typed.current || q.length < 3) {
      setList([]);
      setSearching(false);
      return;
    }
    const hit = cache.current.get(q.toLowerCase());
    if (hit) {
      setList(hit);
      setOpen(hit.length > 0);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api<{ suggestions: AddressSuggestion[] }>(
          `${props.base}/places?q=${encodeURIComponent(q)}&s=${session.current}`,
        );
        cache.current.set(q.toLowerCase(), r.suggestions);
        if (!live) return;
        setList(r.suggestions);
        setOpen(r.suggestions.length > 0);
      } catch {
        // Offline or the lookup failed: the field still works as plain text.
      } finally {
        if (live) setSearching(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [props.value]);

  async function pick(s: AddressSuggestion) {
    typed.current = false;
    setOpen(false);
    if (s.place) props.onPlace?.(s.place);
    props.onInput(s.label);
    if (s.id) {
      const r = await api<{ address: string | null }>(`${props.base}/places/${encodeURIComponent(s.id)}?s=${session.current}`).catch(
        () => null,
      );
      if (r?.address) props.onInput(r.address);
    }
    session.current = newSession();
  }

  return (
    <label class="field suggest">
      <span>
        地址{searching && <em class="searching">搜索中…</em>}
      </span>
      <input
        value={props.value}
        placeholder="输入地址或球馆名，会自动联想"
        autocomplete="street-address"
        onInput={(e) => {
          typed.current = true;
          props.onInput((e.target as HTMLInputElement).value);
        }}
        onFocus={() => setOpen(list.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul class="suggestions">
          {list.map((s) => (
            <li key={s.id ?? s.label}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                {s.place && <strong>{s.place}</strong>}
                <span>{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
