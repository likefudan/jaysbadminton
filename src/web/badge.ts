import { useEffect } from "preact/hooks";
import { setBadge } from "./native";

/**
 * The number on the home-screen icon: how many events are waiting for this member's payment
 * (Ke Li 2026-11-15). Set whenever 我的活动 loads.
 */
export function AppBadge(props: { count: number }) {
  useEffect(() => setBadge(props.count), [props.count]);
  return null;
}
