/**
 * The pictures in the iPhone 添加到主屏幕 guide (Install.tsx): simple drawings of what Safari shows
 * at each step on the latest iOS, with the thing to tap ringed in the accent colour. They are drawn
 * here, not screenshots, so they follow the site's light and dark colours and carry nobody's data.
 * The labels are the ones an iPhone set to English shows; the step text gives the Chinese names.
 */
import type { ComponentChildren } from "preact";

function Art(props: { height: number; children: ComponentChildren }) {
  return (
    <svg class="ig-art" viewBox={`0 0 320 ${props.height}`} aria-hidden="true">
      <rect class="ig-bg" width="320" height={props.height} rx="14" />
      {props.children}
    </svg>
  );
}

/** Where the finger goes. */
const Tap = (props: { x: number; y: number }) => (
  <g class="ig-tap">
    <circle cx={props.x} cy={props.y} r="10" opacity="0.28" />
    <circle cx={props.x} cy={props.y} r="5" />
  </g>
);

/** 1 and 2 on the last picture, where two things are tapped in order. */
const Badge = (props: { x: number; y: number; n: number }) => (
  <g class="ig-badge">
    <circle cx={props.x} cy={props.y} r="8.5" />
    <text x={props.x} y={props.y + 3.6} text-anchor="middle">
      {props.n}
    </text>
  </g>
);

const SHARE = "M0 -8v11M-3.5 -4.5L0 -8l3.5 3.5M-4 -1h-2v9h12v-9h-2";

/** Step 1: Safari's bar at the bottom, the page menu left of the address ringed. */
export function ArtToolbar() {
  const host = location.host.length > 22 ? `${location.host.slice(0, 21)}…` : location.host;
  return (
    <Art height={88}>
      <rect class="ig-ghost" x="20" y="14" width="150" height="7" rx="3.5" />
      <rect class="ig-ghost" x="20" y="27" width="96" height="7" rx="3.5" />
      <circle class="ig-card" cx="34" cy="62" r="17" />
      <path class="ig-ink" d="M37 55l-7 7 7 7" />
      <rect class="ig-card" x="60" y="45" width="200" height="34" rx="17" />
      <circle class="ig-hl" cx="80" cy="62" r="13" />
      <rect class="ig-fill" x="73.5" y="55" width="5.5" height="5.5" rx="1.5" />
      <path class="ig-ink" d="M82 57.8h5M73.5 63.8h13.5M73.5 68.5h9" />
      <text class="ig-text" x="162" y="66.5" text-anchor="middle">
        {host}
      </text>
      <path class="ig-ink" d="M247 58.5a6 6 0 1 0 1.8 4.2M247.2 54.5v4.2h-4.2" />
      <circle class="ig-card" cx="286" cy="62" r="17" />
      <rect class="ig-ink" x="279" y="55" width="10" height="10" rx="2.5" />
      <path class="ig-ink" d="M283 68.5h7.5a2.5 2.5 0 0 0 2.5-2.5v-7.5" />
      <Tap x={91} y={73} />
    </Art>
  );
}

/** Step 2: the menu that opens, Share ringed. */
export function ArtMenu() {
  return (
    <Art height={124}>
      <rect class="ig-card" x="56" y="10" width="208" height="104" rx="16" />
      <rect class="ig-ghost" x="74" y="24" width="12" height="12" rx="3" />
      <rect class="ig-ghost" x="98" y="26.5" width="104" height="7" rx="3.5" />
      <path class="ig-rule" d="M70 46h180" />
      <rect class="ig-hl" x="64" y="51" width="192" height="30" rx="10" />
      <path class="ig-ink" d={SHARE} transform="translate(80 66)" />
      <text class="ig-text" x="98" y="70.5">
        Share
      </text>
      <rect class="ig-ghost" x="74" y="90" width="12" height="12" rx="3" />
      <rect class="ig-ghost" x="98" y="92.5" width="84" height="7" rx="3.5" />
      <Tap x={236} y={72} />
    </Art>
  );
}

/** Step 3: the share sheet, Add to Home Screen ringed at the bottom of the list (View More opens it). */
export function ArtShareSheet() {
  return (
    <Art height={150}>
      {[52, 124, 196].map((x) => (
        <g key={x}>
          <circle class="ig-card" cx={x} cy="28" r="16" />
          <rect class="ig-ghost" x={x - 18} y="52" width="36" height="6" rx="3" />
        </g>
      ))}
      <circle class="ig-card" cx="268" cy="28" r="16" />
      <path class="ig-ink" d="M261 25l7 7 7-7" />
      <text class="ig-small" x="268" y="58.5" text-anchor="middle">
        View More
      </text>
      <rect class="ig-card" x="14" y="70" width="292" height="70" rx="14" />
      <rect class="ig-ghost" x="29" y="82" width="12" height="12" rx="3" />
      <rect class="ig-ghost" x="54" y="84.5" width="96" height="7" rx="3.5" />
      <path class="ig-rule" d="M54 103h240" />
      <rect class="ig-hl" x="20" y="107" width="280" height="28" rx="10" />
      <rect class="ig-ink" x="28.5" y="114.5" width="13" height="13" rx="3.5" />
      <path class="ig-ink" d="M35 118v6M32 121h6" />
      <text class="ig-text" x="54" y="125.5">
        Add to Home Screen
      </text>
      <Tap x={276} y={126} />
    </Art>
  );
}

/** Step 4: the last sheet. The Open as Web App switch on first, then Add. */
export function ArtAddSheet() {
  return (
    <Art height={150}>
      <circle class="ig-card" cx="32" cy="28" r="14" />
      <path class="ig-ink" d="M27.5 23.5l9 9M36.5 23.5l-9 9" />
      <text class="ig-text ig-bold" x="150" y="32.5" text-anchor="middle">
        Add to Home Screen
      </text>
      <rect class="ig-blue" x="250" y="14" width="54" height="28" rx="14" />
      <text class="ig-on-blue" x="277" y="32.5" text-anchor="middle">
        Add
      </text>
      <rect class="ig-ring" x="246" y="10" width="62" height="36" rx="18" />
      <rect class="ig-card" x="14" y="56" width="292" height="38" rx="12" />
      <rect class="ig-app" x="24" y="63" width="24" height="24" rx="6" />
      <rect class="ig-ghost" x="60" y="66" width="70" height="7" rx="3.5" />
      <rect class="ig-ghost" x="60" y="79" width="110" height="5" rx="2.5" />
      <rect class="ig-card" x="14" y="104" width="292" height="36" rx="12" />
      <text class="ig-text" x="28" y="126.5">
        Open as Web App
      </text>
      <rect class="ig-green" x="254" y="111" width="40" height="22" rx="11" />
      <circle class="ig-knob" cx="283" cy="122" r="9" />
      <rect class="ig-ring" x="249" y="106" width="50" height="32" rx="16" />
      <Badge x={250} y={108} n={1} />
      <Badge x={248} y={12} n={2} />
    </Art>
  );
}
