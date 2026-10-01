import { useEffect, useRef, useState } from "preact/hooks";

interface Suggestion {
  label: string; // "1234 Main St, San Jose, CA 95131"
  place: string; // POI name when the result is a place, e.g. "Bay Badminton Center"
}

interface PhotonFeature {
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    town?: string;
    district?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
}

const STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

function format(f: PhotonFeature): Suggestion | null {
  const p = f.properties;
  if (p.countrycode !== "US") return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const city = p.city ?? p.town ?? p.district;
  const state = p.state ? (STATES[p.state] ?? p.state) : "";
  const tail = [state, p.postcode].filter(Boolean).join(" ");
  const label = [street || (p.street ? "" : p.name), city, tail].filter(Boolean).join(", ");
  if (!label) return null;
  return { label, place: street && p.name && p.name !== p.street ? p.name : "" };
}

/**
 * US address field with suggestions as you type (Photon / OpenStreetMap, no key needed).
 * Picking a place also offers its name, so a new venue can be filled from one search.
 */
export function AddressInput(props: { value: string; onInput: (v: string) => void; onPlace?: (name: string) => void }) {
  const [list, setList] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const typed = useRef(false);

  useEffect(() => {
    const q = props.value.trim();
    if (!typed.current || q.length < 4) {
      setList([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        // The group plays on Pacific time, so nearby (West Coast) results come first.
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&lat=37.4&lon=-121.9&zoom=7&location_bias_scale=0.5&bbox=-125,24,-66,50`;
        const res = await fetch(url, { signal: ctrl.signal });
        const json = (await res.json()) as { features: PhotonFeature[] };
        const seen = new Set<string>();
        const items = json.features
          .map(format)
          .filter((s): s is Suggestion => !!s && !seen.has(s.label) && !!seen.add(s.label))
          .slice(0, 5);
        setList(items);
        setOpen(items.length > 0);
      } catch {
        // Offline or blocked: the field still works as plain text.
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [props.value]);

  return (
    <label class="field suggest">
      <span>地址</span>
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
            <li key={s.label}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  typed.current = false;
                  props.onInput(s.label);
                  if (s.place) props.onPlace?.(s.place);
                  setOpen(false);
                }}
              >
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
