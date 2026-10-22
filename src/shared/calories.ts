/**
 * The iOS Shortcut that reads Apple Health for the 卡路里 on an event card. The page runs it by this name
 * (shortcuts://run-shortcut), so it must match the name it is shared under; docs/calories-shortcut.md
 * has the steps to build it. INSTALL_URL is its iCloud link until 设置 gives another.
 */
export const SHORTCUT_NAME = "ReadBadmintonCalories";
export const SHORTCUT_INSTALL_URL = "https://www.icloud.com/shortcuts/909be1bdeb324b88a0caca0b0031aa11";
/**
 * The version INSTALL_URL installs, until 设置 gives another. The Shortcut sends it as `v` with the
 * number (the first one sent none: 1); members who last uploaded with an older one are asked to update
 * on the event card. A new version is set in 设置 together with its link (Ke Li: no deploy needed).
 */
export const SHORTCUT_VERSION = 2;
/** An iCloud link to a shared Shortcut, as 设置 takes it. */
export const SHORTCUT_URL_RE = /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/;
