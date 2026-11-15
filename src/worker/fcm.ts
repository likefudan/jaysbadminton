import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "./env";

/**
 * Pushes to the phone apps (Ke Li 2026-11-15: getting ready for the iPhone and Android apps). A
 * browser gets Web Push (push.ts); an app has no service worker, so it hands over a Firebase
 * Cloud Messaging token instead and Firebase passes the push on (to Apple's service on an iPhone).
 * Off, and nothing here runs, until the FCM_SERVICE_ACCOUNT secret is set.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** What subscriptions of this kind are stored under: `fcm:<token>` in push_subscriptions.endpoint. */
export const FCM_PREFIX = "fcm:";
const TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/;

export const isFcmToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);

function account(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const a = JSON.parse(env.FCM_SERVICE_ACCOUNT) as Partial<ServiceAccount>;
    return a.project_id && a.client_email && a.private_key ? (a as ServiceAccount) : null;
  } catch {
    return null;
  }
}

export const fcmConfigured = (env: Env): boolean => account(env) !== null;

// Google's access token lasts an hour: one signature per hour per isolate, not per push.
let access: { email: string; token: string; until: number } | null = null;

/** For tests: forget the access token. */
export function forgetFcmAccess(): void {
  access = null;
}

async function accessToken(a: ServiceAccount): Promise<string> {
  if (access && access.email === a.client_email && access.until > Date.now() + 60_000) return access.token;
  const key = await importPKCS8(a.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(a.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`fcm sign-in failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  access = { email: a.client_email, token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return access.token;
}

export type FcmOutcome = "sent" | "gone" | "drop" | "retry";

/** One push to one app. `payload` is a PushMessage as JSON (title, body, url, tag). */
export async function fcmSend(env: Env, token: string, payload: string, ttlSeconds: number): Promise<FcmOutcome> {
  const a = account(env);
  // Turned off since they subscribed: nothing can be sent, and the app stays subscribed.
  if (!a) return "drop";
  const msg = JSON.parse(payload) as { title: string; body: string; url: string; tag: string };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(a.project_id)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(a)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: msg.title, body: msg.body },
        // What the app opens on tap.
        data: { url: msg.url, tag: msg.tag },
        // Same tag: replaces the earlier notification instead of stacking, as in a browser.
        android: { ttl: `${ttlSeconds}s`, collapse_key: msg.tag, notification: { tag: msg.tag } },
        apns: {
          headers: {
            "apns-collapse-id": msg.tag.slice(0, 64),
            "apns-expiration": String(Math.floor(Date.now() / 1000) + ttlSeconds),
          },
          payload: { aps: { sound: "default" } },
        },
      },
    }),
  });
  if (res.ok) {
    await res.body?.cancel();
    return "sent";
  }
  const detail = await res.text().catch(() => "");
  // The app was removed or its token replaced.
  if (res.status === 404 || detail.includes("UNREGISTERED")) return "gone";
  console.warn(`push to an app failed: ${res.status} ${detail.slice(0, 300)}`);
  // Our sign-in was refused: a new one next time.
  if (res.status === 401) access = null;
  if (res.status === 400 || res.status === 401 || res.status === 403) return "drop";
  return "retry";
}
