import type { AddressSuggestion } from "../shared/types";
import type { Env } from "./env";

/**
 * Address suggestions for the venue form, looked up on the server so the Google key never
 * reaches the browser. Google Places (New) when GOOGLE_MAPS_API_KEY is set, otherwise the free
 * Photon service. Both search Northern California first.
 */

// Northern California, roughly Monterey/Fresno up to the Oregon border.
const NORCAL = { south: 36.0, west: -124.5, north: 42.0, east: -119.0 };
const US = { south: 24, west: -125, north: 50, east: -66 };

const stripUsa = (s: string) => s.replace(/,\s*(USA|United States)$/, "");

export async function suggestAddresses(env: Env, q: string, session: string): Promise<AddressSuggestion[]> {
  return env.GOOGLE_MAPS_API_KEY ? google(env.GOOGLE_MAPS_API_KEY, q, session) : photon(q);
}

interface GooglePrediction {
  placeId: string;
  text: { text: string };
  structuredFormat?: { mainText: { text: string }; secondaryText?: { text: string } };
  types?: string[];
}

async function google(key: string, q: string, session: string): Promise<AddressSuggestion[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({
      input: q,
      sessionToken: session || undefined,
      includedRegionCodes: ["us"],
      languageCode: "en",
      locationBias: {
        rectangle: { low: { latitude: NORCAL.south, longitude: NORCAL.west }, high: { latitude: NORCAL.north, longitude: NORCAL.east } },
      },
    }),
  });
  if (!res.ok) {
    console.error("places autocomplete failed:", res.status, (await res.text()).slice(0, 200));
    return photon(q); // quota hit or key problem: still offer something
  }
  const json = (await res.json()) as { suggestions?: { placePrediction?: GooglePrediction }[] };
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is GooglePrediction => !!p)
    .slice(0, 5)
    .map((p) => {
      const business = p.types?.includes("establishment") && p.structuredFormat;
      return {
        id: p.placeId,
        place: business ? p.structuredFormat!.mainText.text : "",
        label: stripUsa(business ? (p.structuredFormat!.secondaryText?.text ?? "") : p.text.text),
      };
    });
}

/** The full street address of a picked Google suggestion; ends the billing session. */
export async function resolveAddress(env: Env, id: string, session: string): Promise<string | null> {
  if (!env.GOOGLE_MAPS_API_KEY || !/^[A-Za-z0-9_-]{10,300}$/.test(id)) return null;
  const url = `https://places.googleapis.com/v1/places/${id}${session ? `?sessionToken=${encodeURIComponent(session)}` : ""}`;
  const res = await fetch(url, { headers: { "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": "formattedAddress" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { formattedAddress?: string };
  return json.formattedAddress ? stripUsa(json.formattedAddress) : null;
}

// ---- Photon (OpenStreetMap), free and keyless but slower ----

interface PhotonFeature {
  properties: Record<string, string | undefined>;
}

const STATES: Record<string, string> = { California: "CA", Oregon: "OR", Nevada: "NV", Washington: "WA", Arizona: "AZ" };

function fromPhoton(f: PhotonFeature): AddressSuggestion | null {
  const p = f.properties;
  if (p.countrycode !== "US") return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const city = p.city ?? p.town ?? p.district;
  const state = p.state ? (STATES[p.state] ?? p.state) : "";
  const label = [street || p.name, city, [state, p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (!label) return null;
  return { id: null, place: street && p.name && p.name !== p.street ? p.name : "", label };
}

async function photonIn(q: string, box: typeof US): Promise<AddressSuggestion[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&bbox=${box.west},${box.south},${box.east},${box.north}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { features: PhotonFeature[] };
    const seen = new Set<string>();
    return json.features
      .map(fromPhoton)
      .filter((s): s is AddressSuggestion => !!s && !seen.has(s.label) && !!seen.add(s.label))
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function photon(q: string): Promise<AddressSuggestion[]> {
  const near = await photonIn(q, NORCAL);
  return near.length > 0 ? near : photonIn(q, US);
}
