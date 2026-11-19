/**
 * The phone apps that open this site (Ke Li 2026-11-15: getting ready for them). A site vouches for
 * an app in a file under /.well-known/, and the phone then opens the site's links (an event's
 * /e/ link from a chat) in the app, and lets the Android app show the site without an address bar.
 *
 * Android: the app in android/ (one app for every group's site), by the certificate it is signed
 * with. The test builds are signed with a key kept in the repository's secrets (android.yml); the
 * test site vouches for it once its SHA-256 is added here. The key that used to sit in the
 * repository is public, so nothing vouches for it any more. The real sites vouch for nobody until
 * there is a release key: add its SHA-256 here.
 * iPhone: no app yet: add "<Team ID>.<bundle id>" here when there is one.
 */
export const ANDROID_PACKAGE = "dev.llmat.badminton";
export const ANDROID_TEST_CERTS: string[] = [];
export const ANDROID_RELEASE_CERTS: string[] = [];
export const IOS_APP_IDS: string[] = [];

/** /.well-known/assetlinks.json, or null while this site vouches for no Android app. */
export function assetLinks(staging: boolean, testCerts: string[] = ANDROID_TEST_CERTS): object[] | null {
  const certs = staging ? [...testCerts, ...ANDROID_RELEASE_CERTS] : ANDROID_RELEASE_CERTS;
  if (certs.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: certs },
    },
  ];
}

/** /.well-known/apple-app-site-association, or null while there is no iPhone app. The 管理页 and the API stay in the browser. */
export function appleAppSiteAssociation(ids: string[] = IOS_APP_IDS): object | null {
  if (ids.length === 0) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: ids,
          components: [{ "/": "/api/*", exclude: true }, { "/": "/admin*", exclude: true }, { "/": "/*" }],
        },
      ],
    },
    webcredentials: { apps: ids },
  };
}
