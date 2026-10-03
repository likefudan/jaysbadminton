import { toPacific } from "../shared/time";
import { STATUS_ZH, type EventStatus } from "../shared/types";
import type { Env } from "./env";
import { friendLabel } from "./events";
import { eventNumber } from "./paymentCode";

/**
 * Every table the Owner can export, shaped for people: Chinese headers, dollars, Pacific times.
 * The same tables feed the CSV downloads and the Google Sheet. Tokens and password hashes never
 * appear here.
 */
export interface Table {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

type R = Record<string, any>;
const money = (cents: number | null | undefined) => (cents == null ? "" : Math.round(cents) / 100);
const at = (iso: string | null | undefined) => {
  if (!iso) return "";
  const p = toPacific(iso);
  return `${p.date} ${p.time}`;
};
const yes = (v: unknown) => (v ? "是" : "");
const MEMBER_STATUS: Record<string, string> = { pending: "待审核", active: "正常", inactive: "已停用", rejected: "已拒绝" };
const PAY_STATUS: Record<string, string> = { unpaid: "未付", partial: "部分付款", paid: "已付" };
const INBOUND_STATE: Record<string, string> = { open: "待确认", linked: "已关联", ignored: "已忽略" };

async function all(env: Env, sql: string): Promise<R[]> {
  return (await env.DB.prepare(sql).all<R>()).results;
}

export const TABLES = {
  members: {
    title: "成员",
    async build(env: Env): Promise<Table> {
      const rows = await all(env, "SELECT * FROM members ORDER BY id");
      return {
        title: this.title,
        columns: ["成员编号", "用户名", "微信昵称", "邮箱", "管理员备注", "状态", "Owner", "申请时间", "通过时间"],
        rows: rows.map((m) => [
          m.id,
          m.username,
          m.wechat_nickname,
          m.email || m.google_email || "",
          m.admin_note ?? "",
          m.deleted_at ? "已删除" : (MEMBER_STATUS[m.status] ?? m.status),
          yes(m.is_owner),
          at(m.requested_at),
          at(m.approved_at),
        ]),
      };
    },
  },
  events: {
    title: "活动",
    async build(env: Env): Promise<Table> {
      const rows = await all(
        env,
        `SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS signed,
           (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.attended = 1) AS came
         FROM events e ORDER BY e.start_at`,
      );
      return {
        title: this.title,
        columns: ["活动编号", "标题", "日期", "开始", "结束", "场馆", "地址", "状态", "报名人数", "到场人数", "报名截止", "结算时间", "收齐时间"],
        rows: rows.map((e) => [
          eventNumber(e.date, e.code),
          e.title ?? "",
          e.date,
          toPacific(e.start_at).time,
          toPacific(e.end_at).time,
          e.location,
          e.address ?? "",
          STATUS_ZH[e.status as EventStatus] ?? e.status,
          e.signed,
          ["finalized", "settled"].includes(e.status) ? e.came : "",
          at(e.deadline_at),
          at(e.finalized_at),
          at(e.settled_at),
        ]),
      };
    },
  },
  registrations: {
    title: "报名",
    async build(env: Env): Promise<Table> {
      const rows = await all(
        env,
        `SELECT r.*, e.date, e.code, m.username FROM registrations r
         JOIN events e ON e.id = r.event_id JOIN members m ON m.id = r.member_id
         ORDER BY e.start_at, r.member_id, r.friend_index`,
      );
      return {
        title: this.title,
        columns: ["活动编号", "日期", "成员编号", "成员", "名字", "是朋友", "到场", "管理员添加", "报名时间"],
        rows: rows.map((r) => [
          eventNumber(r.date, r.code),
          r.date,
          r.member_id,
          r.username,
          r.friend_index === 0 ? r.username : friendLabel(r.username, r.friend_index, r.friend_name),
          yes(r.friend_index > 0),
          r.attended ? "到场" : "未到",
          yes(r.added_by_owner),
          at(r.created_at),
        ]),
      };
    },
  },
  settlements: {
    title: "结算",
    async build(env: Env): Promise<Table> {
      const rows = await all(env, "SELECT s.*, e.date, e.code FROM settlements s JOIN events e ON e.id = s.event_id ORDER BY e.start_at");
      return {
        title: this.title,
        columns: ["活动编号", "日期", "场地费", "用球个数", "球单价", "球费", "总费用", "报名人数", "到场人数", "每人场地费", "每人球费", "结算时间"],
        rows: rows.map((s) => {
          const shuttle = s.shuttle_count * s.shuttle_price_cents;
          return [
            eventNumber(s.date, s.code),
            s.date,
            money(s.court_total_cents),
            s.shuttle_count,
            money(s.shuttle_price_cents),
            money(shuttle),
            money(s.court_total_cents + shuttle),
            s.registered_count,
            s.attended_count,
            money(s.court_share_cents),
            money(s.shuttle_share_cents),
            at(s.finalized_at),
          ];
        }),
      };
    },
  },
  payments: {
    title: "应付款",
    async build(env: Env): Promise<Table> {
      const rows = await all(
        env,
        `SELECT p.*, e.date, e.code, m.username FROM payments p
         JOIN events e ON e.id = p.event_id JOIN members m ON m.id = p.member_id ORDER BY e.start_at, m.username`,
      );
      return {
        title: this.title,
        columns: ["活动编号", "日期", "成员编号", "成员", "付款编号", "应付", "已收", "已退", "状态", "付清时间"],
        rows: rows.map((p) => [
          eventNumber(p.date, p.code),
          p.date,
          p.member_id,
          p.username,
          p.payment_code,
          money(p.amount_due_cents),
          money(p.amount_paid_cents),
          money(p.refunded_cents),
          PAY_STATUS[p.status] ?? p.status,
          at(p.paid_at),
        ]),
      };
    },
  },
  receipts: {
    title: "付款明细",
    async build(env: Env): Promise<Table> {
      const rows = await all(
        env,
        `SELECT pr.*, e.date, e.code, m.username FROM payment_receipts pr JOIN payments p ON p.id = pr.payment_id
         JOIN events e ON e.id = p.event_id JOIN members m ON m.id = p.member_id ORDER BY pr.received_at`,
      );
      return {
        title: this.title,
        columns: ["时间", "活动编号", "日期", "成员", "金额", "方式", "Venmo 付款人", "Venmo 交易编号"],
        rows: rows.map((r) => [
          at(r.received_at),
          eventNumber(r.date, r.code),
          r.date,
          r.username,
          money(r.amount_cents),
          r.method === "venmo" ? "Venmo" : "手动",
          r.payer_name ?? "",
          r.venmo_txn_id ?? "",
        ]),
      };
    },
  },
  inbound: {
    title: "待确认收款",
    async build(env: Env): Promise<Table> {
      const rows = await all(
        env,
        `SELECT i.*, m.username FROM inbound_payments i LEFT JOIN payments p ON p.id = i.linked_payment_id
         LEFT JOIN members m ON m.id = p.member_id ORDER BY i.received_at`,
      );
      return {
        title: this.title,
        columns: ["收到时间", "付款人", "金额", "备注", "原因", "处理", "关联到", "Venmo 交易编号"],
        rows: rows.map((i) => [
          at(i.received_at),
          i.payer_name ?? "",
          money(i.amount_cents),
          i.note ?? "",
          i.reason ?? "",
          INBOUND_STATE[i.state] ?? i.state,
          i.username ?? "",
          i.venmo_txn_id ?? "",
        ]),
      };
    },
  },
  locations: {
    title: "场馆",
    async build(env: Env): Promise<Table> {
      const rows = await all(env, "SELECT * FROM locations ORDER BY last_used_at DESC");
      return {
        title: this.title,
        columns: ["场馆", "地址", "使用次数", "最近使用"],
        rows: rows.map((l) => [l.name, l.address ?? "", l.use_count, at(l.last_used_at)]),
      };
    },
  },
} as const;

export type TableName = keyof typeof TABLES;
export const isTable = (n: string): n is TableName => n in TABLES;

/**
 * Text a spreadsheet would run as a formula (a leading = + - @, tab or return) gets a leading '
 * so it stays text; names and notes come from anyone who applies or pays. Numbers pass through.
 */
export function asText(v: string | number): string | number {
  return typeof v === "string" && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
}

/** For the Google Sheet, which writes every cell with setValues: the same guard as the CSV. */
export async function exportAll(env: Env): Promise<{ generatedAt: string; tables: Record<TableName, Table> }> {
  const tables = {} as Record<TableName, Table>;
  for (const name of Object.keys(TABLES) as TableName[]) {
    const t = await TABLES[name].build(env);
    tables[name] = { ...t, rows: t.rows.map((r) => r.map(asText)) };
  }
  return { generatedAt: at(new Date().toISOString()), tables };
}

/** CSV with a BOM so Excel opens the Chinese text correctly. */
export function toCsv(t: Table): string {
  const cell = (v: string | number) => {
    // A leading = + - @ would run as a formula in Excel; asText marks it as text.
    const safe = String(asText(v));
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [t.columns, ...t.rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
