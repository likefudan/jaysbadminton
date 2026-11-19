import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ANDROID_PACKAGE, ANDROID_TEST_CERTS, appleAppSiteAssociation, assetLinks } from "../src/shared/apps";
import worker from "../src/worker/index";
import { ORIGIN } from "./helpers";

async function get(path: string, vars: object = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`), { ...env, ...vars }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("the files that vouch for the phone apps", () => {
  it("the test site vouches for the test builds of the Android app once their key is listed", async () => {
    // The key that used to be in the repository is public: nothing vouches for it.
    expect(ANDROID_TEST_CERTS).toEqual([]);
    expect((await get("/.well-known/assetlinks.json", { ENVIRONMENT: "staging" })).status).toBe(404);
    expect(assetLinks(true, ["AA:BB"])).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ["AA:BB"] },
      },
    ]);
    expect(assetLinks(false, ["AA:BB"])).toBeNull();
  });

  it("a real site vouches for nobody until there is a release key, and never for the test key", async () => {
    expect(assetLinks(false)).toBeNull();
    expect((await get("/.well-known/assetlinks.json", { ENVIRONMENT: "production" })).status).toBe(404);
  });

  it("there is no iPhone app yet; with one, its links open in it except the 管理页 and the API", async () => {
    expect((await get("/.well-known/apple-app-site-association")).status).toBe(404);
    expect(appleAppSiteAssociation(["ABCDE12345.dev.llmat.badminton"])).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["ABCDE12345.dev.llmat.badminton"],
            components: [{ "/": "/api/*", exclude: true }, { "/": "/admin*", exclude: true }, { "/": "/*" }],
          },
        ],
      },
      webcredentials: { apps: ["ABCDE12345.dev.llmat.badminton"] },
    });
  });
});
