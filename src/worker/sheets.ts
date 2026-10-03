import { getSettings, now, setSetting } from "./db";
import type { Env } from "./env";
import { decryptToken, encryptToken, randomToken, sha256 } from "./lib/crypto";
import { TABLES } from "./export";

/**
 * Google Sheets mirror. The site never logs into Google: the Owner pastes a small Apps Script
 * into their own sheet, and that script pulls /export/<key>/all.json once a day. The key is kept
 * hashed (to check requests) and encrypted (so the admin page can show the script again).
 */

export interface SheetsStatus {
  enabled: boolean;
  lastSyncAt: string | null;
}

export async function sheetsStatus(env: Env): Promise<SheetsStatus> {
  const s = await getSettings(env.DB, ["export_key_hash", "export_last_at"]);
  return { enabled: !!s.export_key_hash, lastSyncAt: s.export_last_at ?? null };
}

/** Creates a new key (the old one stops working at once) and returns the script to paste. */
export async function rotateExportKey(env: Env): Promise<string> {
  const key = randomToken();
  await env.DB.batch([
    setSetting(env.DB, "export_key_hash", await sha256(key)),
    setSetting(env.DB, "export_key_enc", await encryptToken(key, env.TOKEN_KEY)),
    env.DB.prepare("DELETE FROM settings WHERE key = 'export_last_at'"),
  ]);
  return appsScript(env.SITE_ORIGIN, key);
}

/**
 * The script with the current key, for the admin page. keyLost: sync is on but its key can't be
 * decrypted (TOKEN_KEY was replaced), so the Owner has to make a new one; the old script, which
 * still holds the key, keeps working until then.
 */
export async function currentScript(env: Env): Promise<{ script: string | null; keyLost: boolean }> {
  const s = await getSettings(env.DB, ["export_key_enc"]);
  if (!s.export_key_enc) return { script: null, keyLost: false };
  try {
    return { script: appsScript(env.SITE_ORIGIN, await decryptToken(s.export_key_enc, env.TOKEN_KEY)), keyLost: false };
  } catch {
    return { script: null, keyLost: true };
  }
}

export async function disableExport(env: Env): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM settings WHERE key IN ('export_key_hash', 'export_key_enc', 'export_last_at')",
  ).run();
}

/** Checks an /export/<key>/… request and records when the sheet last pulled. */
export async function checkExportKey(env: Env, key: string): Promise<boolean> {
  const s = await getSettings(env.DB, ["export_key_hash"]);
  if (!s.export_key_hash || s.export_key_hash !== (await sha256(key))) return false;
  await setSetting(env.DB, "export_last_at", now()).run();
  return true;
}

/** The Apps Script the Owner pastes into 扩展程序 → Apps Script. Kept small and readable. */
export function appsScript(site: string, key: string): string {
  const tabs = Object.fromEntries(Object.entries(TABLES).map(([name, t]) => [name, t.title]));
  return `/**
 * 羽毛球群数据同步（只读）：每天从网站拉取一次数据，覆盖写入各个标签页。
 * 第一次：选择函数 install，点「运行」，按提示授权（看到「Google 尚未验证此应用」时，
 * 点「高级」→「转到…（不安全）」→「允许」）。之后每天凌晨 3 点（太平洋时间）自动同步。
 * 想立刻同步一次：选择函数 sync，点「运行」。
 * 表格里的修改不会传回网站；下次同步会被覆盖。需要历史版本时用「文件 → 版本记录」。
 */
const SITE = ${JSON.stringify(site)};
const KEY = ${JSON.stringify(key)};
const TABS = ${JSON.stringify(tabs, null, 2)};

function sync() {
  const res = UrlFetchApp.fetch(SITE + "/export/" + KEY + "/all.json", { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("同步失败（" + res.getResponseCode() + "）：同步密钥可能已在管理页重新生成，请粘贴新的脚本。");
  }
  const data = JSON.parse(res.getContentText());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    const t = data.tables[name];
    if (!t) return;
    const sheet = ss.getSheetByName(TABS[name]) || ss.insertSheet(TABS[name]);
    sheet.clearContents();
    const values = [t.columns].concat(t.rows);
    sheet.getRange(1, 1, values.length, t.columns.length).setValues(values);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, t.columns.length).setFontWeight("bold");
  });
  const info = ss.getSheetByName("同步记录") || ss.insertSheet("同步记录");
  if (info.getLastRow() === 0) info.appendRow(["同步时间（太平洋时间）", "网站"]);
  info.appendRow([data.generatedAt, SITE]);
}

function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sync") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sync").timeBased().everyDays(1).atHour(3).inTimezone("America/Los_Angeles").create();
  sync();
}
`;
}
