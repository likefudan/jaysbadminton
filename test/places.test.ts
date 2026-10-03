import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAddress, suggestAddresses } from "../src/worker/places";
import { setUpAdmin } from "./helpers";

let calls: { url: string; init?: RequestInit }[] = [];
let reply: (url: string) => unknown;

beforeEach(() => {
  calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return Response.json(reply(url));
  });
});
afterEach(() => vi.restoreAllMocks());

const photonFeature = (p: Record<string, string>) => ({ properties: { countrycode: "US", ...p } });

describe("address suggestions without a Google key (Photon)", () => {
  it("searches Northern California first and only then the rest of the US", async () => {
    const ctx = await setUpAdmin();
    reply = (url) =>
      url.includes("bbox=-124.5,36,-119,42")
        ? { features: [] }
        : {
            features: [
              photonFeature({
                name: "Silver Bay Court",
                street: "Silver Bay Road",
                city: "Hague",
                state: "New York",
                postcode: "12874",
              }),
            ],
          };
    const r = (await ctx.admin.call(`${ctx.base}/places?q=silver%20bay&s=abc`)).data;
    expect(calls.map((c) => c.url.match(/bbox=([^&]+)/)![1])).toEqual(["-124.5,36,-119,42", "-125,24,-66,50"]);
    expect(r.suggestions).toEqual([
      { id: null, place: "Silver Bay Court", label: "Silver Bay Road, Hague, New York 12874" },
    ]);
  });

  it("formats a nearby business with its street address and skips short queries", async () => {
    const ctx = await setUpAdmin();
    reply = () => ({
      features: [
        photonFeature({
          name: "Bay Badminton Center",
          housenumber: "1191",
          street: "Montague Expressway",
          city: "Milpitas",
          state: "California",
          postcode: "95035",
        }),
        photonFeature({ name: "Somewhere", countrycode: "CA" }),
      ],
    });
    const r = (await ctx.admin.call(`${ctx.base}/places?q=bay%20bad`)).data;
    expect(r.suggestions).toEqual([
      { id: null, place: "Bay Badminton Center", label: "1191 Montague Expressway, Milpitas, CA 95035" },
    ]);
    expect(calls).toHaveLength(1);
    expect((await ctx.admin.call(`${ctx.base}/places?q=ba`)).data.suggestions).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("address suggestions with Google Places", () => {
  const google = { ...env, GOOGLE_MAPS_API_KEY: "test-key" };

  it("biases to Northern California, keeps the key server-side, and resolves the full address", async () => {
    reply = (url) =>
      url.endsWith(":autocomplete")
        ? {
            suggestions: [
              {
                placePrediction: {
                  placeId: "ChIJbay123",
                  text: { text: "Bay Badminton Center, Montague Expressway, Milpitas, CA, USA" },
                  structuredFormat: {
                    mainText: { text: "Bay Badminton Center" },
                    secondaryText: { text: "Montague Expressway, Milpitas, CA, USA" },
                  },
                  types: ["establishment", "point_of_interest"],
                },
              },
              {
                placePrediction: {
                  placeId: "ChIJaddr456",
                  text: { text: "1191 Montague Expy, Milpitas, CA, USA" },
                  types: ["street_address"],
                },
              },
            ],
          }
        : { formattedAddress: "1191 Montague Expy, Milpitas, CA 95035, USA" };

    expect(await suggestAddresses(google, "bay badminton", "sess-1")).toEqual([
      { id: "ChIJbay123", place: "Bay Badminton Center", label: "Montague Expressway, Milpitas, CA" },
      { id: "ChIJaddr456", place: "", label: "1191 Montague Expy, Milpitas, CA" },
    ]);
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body).toMatchObject({ input: "bay badminton", sessionToken: "sess-1", includedRegionCodes: ["us"] });
    expect(body.locationBias.rectangle).toEqual({
      low: { latitude: 36, longitude: -124.5 },
      high: { latitude: 42, longitude: -119 },
    });
    expect(new Headers(calls[0]!.init!.headers).get("X-Goog-Api-Key")).toBe("test-key");

    expect(await resolveAddress(google, "ChIJbay123", "sess-1")).toBe("1191 Montague Expy, Milpitas, CA 95035");
    expect(calls[1]!.url).toBe("https://places.googleapis.com/v1/places/ChIJbay123?sessionToken=sess-1");
    expect(new Headers(calls[1]!.init!.headers).get("X-Goog-FieldMask")).toBe("formattedAddress");
    expect(await resolveAddress(google, "../evil", "s")).toBeNull();
  });

  it("falls back to Photon when Google refuses (quota or key problem)", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url });
      if (url.includes("googleapis")) return new Response("quota", { status: 429 });
      return Response.json({
        features: [photonFeature({ housenumber: "1", street: "Main St", city: "San Jose", state: "California" })],
      });
    });
    expect(await suggestAddresses(google, "1 main st", "s")).toEqual([
      { id: null, place: "", label: "1 Main St, San Jose, CA" },
    ]);
  });
});
