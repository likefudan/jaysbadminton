/**
 * The iOS Shortcut that reads Apple Health for the 卡路里 on an event card. The page runs it by this name
 * (shortcuts://run-shortcut), so it must match the name it is shared under; docs/calories-shortcut.md
 * has the steps to build it. INSTALL_URL is its iCloud link (empty: not shared yet).
 */
export const SHORTCUT_NAME = "ReadBadmintonCalories";
export const SHORTCUT_INSTALL_URL = "https://www.icloud.com/shortcuts/71f9d5e777b84f72bebf91b44a1e1508";
/**
 * The version INSTALL_URL installs. The Shortcut sends it as `v` with the number (the first one sent
 * none: 1); members who last uploaded with an older one are asked to update on the event card. Raise
 * it only together with a new INSTALL_URL.
 */
export const SHORTCUT_VERSION = 1;
