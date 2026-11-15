/**
 * Where the page meets the phone (Ke Li 2026-11-15: getting ready for the iPhone and Android apps,
 * which show this same site inside an app). What a phone does differently in an app than in a
 * browser goes through here, so the pages don't ask which one they are in: today the number on the
 * icon and a short buzz; later turning push on, signing in and reading calories.
 */
type Plugin = Record<string, ((options?: object) => Promise<unknown>) | undefined>;
type Capacitor = { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: Record<string, Plugin> };
const capacitor = () => (window as { Capacitor?: Capacitor }).Capacitor;

const TWA_KEY = "in-android-app";

/**
 * The app this page is shown in, or null in a browser (the site added to the home screen is a
 * browser too). The iPhone app is a Capacitor shell; the Android app shows the site in Chrome
 * without its bars (a Trusted Web Activity), which says so only on the first page: remembered
 * for the visit.
 */
export function appShell(): "ios" | "android" | null {
  const c = capacitor();
  if (c?.isNativePlatform?.()) return c.getPlatform?.() === "android" ? "android" : "ios";
  try {
    if (document.referrer.startsWith("android-app://")) sessionStorage.setItem(TWA_KEY, "1");
    return sessionStorage.getItem(TWA_KEY) ? "android" : null;
  } catch {
    return null;
  }
}

type Badged = Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** The number on the app's icon; none at 0. Nothing where there is no such thing. */
export function setBadge(count: number): void {
  try {
    const badge = capacitor()?.Plugins?.Badge;
    if (appShell() === "ios" && badge) {
      void (count > 0 ? badge.set?.({ count }) : badge.clear?.())?.catch(() => {});
      return;
    }
    const nav = navigator as Badged;
    void (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => {});
  } catch {
    // not allowed here: no badge
  }
}

/** A short buzz when something was saved, as apps give. Android only in a browser: the iPhone has none for web pages. */
export function buzz(): void {
  try {
    const haptics = capacitor()?.Plugins?.Haptics;
    if (appShell() === "ios" && haptics) void haptics.impact?.({ style: "LIGHT" })?.catch(() => {});
    else navigator.vibrate?.(12);
  } catch {
    // no buzz here
  }
}
