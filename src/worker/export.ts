import { toPacific } from "../shared/time";
import { STATUS_ZH, type EventStatus } from "../shared/types";
import type { Env } from "./env";
import { friendLabel } from "./events";
import { ROLE_TITLE, memberRole, type RoleFields } from "./organizers";
import { managerSql, payeeSql } from "./payees";

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
/**
 * A 负责人 / 收款人 column: the person's name, the Owner's included (as bills name payees). The
 * query joins the person through managerSql / payeeSql, so old rows with the column empty name the Owner.
 */
const person = (name: string | null) => name?.trim() || "群主";
const MEMBER_STATUS: Record<string, string> = {
  pending: "待审核",
  active: "正常",
  inactive: "已停用",
  rejected: "已拒绝",
};
const PAY_STATUS: Record<string, string> = { unpaid: "未付", partial: "部分付款", paid: "已付" };
const INBOUND_STATE: Record<string, string> = {
  open: "待确认",
  linked: "已关联",
  ignored: "已忽略",
  deleted: "已删除",
};

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
        columns: ["成员编号", "用户名", "微信昵称", "邮箱", "群主备注", "状态", "身份", "申请时间", "通过时间"],
        rows: rows.map((m) => [
          m.id,
          m.username,
          m.wechat_nickname,
          m.email || m.google_email || "",
          m.admin_note ?? "",
          m.deleted_at ? "已删除" : (MEMBER_STATUS[m.status] ?? m.status),
          // As the site treats them now: an organizer counts only while the feature is on.
          ROLE_TITLE[memberRole(env, m as RoleFields)],
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
           (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.attended = 1) AS came,
           mm.username AS manager_name,
           pm.username AS payee_name
         FROM events e
         LEFT JOIN members mm ON mm.id = ${managerSql("e")}
         LEFT JOIN members pm ON pm.id = ${payeeSql("e")}
         ORDER BY e.start_at`,
      );
      return {
        title: this.title,
        columns: [
          "活动编号",
          "标题",
          "日期",
          "开始",
          "结束",
          "场馆",
          "地址",
          "状态",
          "报名人数",
          "到场人数",
          "报名截止",
          "结算时间",
          "收齐时间",
          "负责人",
          "收款人",
        ],
        rows: rows.map((e) => [
          e.number,
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
          person(e.manager_name),
          person(e.payee_name),
        ]),
      };
    },
  },
  registrations: {
    title: "报名",
    async build(env: Env): Promise<Table> {
      const rows = await all(
        env,
        `SELECT r.*, e.date, e.number, m.username, p.username AS paid_by_name FROM registrations r
         JOIN events e ON e.id = r.event_id JOIN members m ON m.id = r.member_id
         LEFT JOIN members p ON p.id = r.paid_by
         ORDER BY e.start_at, r.member_id, r.friend_index`,
      );
      return {
        title: this.title,
        columns: ["活动编号", "日期", "成员编号", "成员", "名字", "是朋友", "到场", "群主添加", "报名时间", "带他的人"],
        rows: rows.map((r) => [
          r.number,
          r.date,
          r.member_id,
          r.username,
          r.friend_index === 0 ? r.username : friendLabel(r.username, r.friend_index, r.friend_name),
          yes(r.friend_index > 0),
          r.attended ? "到场" : "未到",
          yes(r.added_by_owner),
          at(r.created_at),
          // 带群友: who brought them and pays for them; empty when they pay for themselves.
          r.paid_by_name ?? "",
        ]),
      };
    },
  },
  settlements: {
    title: "结算",
    async build(env: Env): Promise<Table> {
      const rows = await all(
        env,
        "SELECT s.*, e.date, e.number FROM settlements s JOIN events e ON e.id = s.event_id ORDER BY e.start_at",
      );
      return {
        title: this.title,
        columns: [
          "活动编号",
          "日期",
          "场地费",
          "用球个数",
          "球单价",
          "球费",
          "总费用",
          "报名人数",
          "到场人数",
          "每人场地费",
          "每人球费",
          "结算时间",
        ],
        rows: rows.map((s) => {
          const shuttle = s.shuttle_count * s.shuttle_price_cents;
          return [
            s.number,
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
        `SELECT p.*, e.date, e.number, m.username, pm.username AS payee_name
         FROM payments p JOIN events e ON e.id = p.event_id JOIN members m ON m.id = p.member_id
         LEFT JOIN members pm ON pm.id = ${payeeSql("e")}
         ORDER BY e.start_at, m.username`,
      );
      return {
        title: this.title,
        columns: [
          "活动编号",
          "日期",
          "成员编号",
          "成员",
          "付款编号",
          "应付",
          "已收",
          "已退",
          "状态",
          "付清时间",
          "钱在谁的账户",
        ],
        rows: rows.map((p) => [
          p.number,
          p.date,
          p.member_id,
          p.username,
          p.payment_code,
          money(p.amount_due_cents),
          money(p.amount_paid_cents + p.refunded_cents),
          money(p.refunded_cents),
          PAY_STATUS[p.status] ?? p.status,
          at(p.paid_at),
          person(p.payee_name),
        ]),
      };
    },
  },
  receipts: {
    title: "付款明细",
    async build(env: Env): Promise<Table> {
      const rows = await all(
        env,
        `SELECT pr.*, e.date, e.number, m.username FROM payment_receipts pr JOIN payments p ON p.id = pr.payment_id
         JOIN events e ON e.id = p.event_id JOIN members m ON m.id = p.member_id ORDER BY pr.received_at`,
      );
      return {
        title: this.title,
        columns: ["时间", "活动编号", "日期", "成员", "金额", "方式", "Venmo 付款人", "Venmo 交易编号"],
        rows: rows.map((r) => [
          at(r.received_at),
          r.number,
          r.date,
          r.username,
          money(r.amount_cents),
          r.method === "venmo" ? "Venmo" : r.method === "refund" ? "退款" : "手动",
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
        `SELECT i.*, m.username, pm.username AS payee_name
         FROM inbound_payments i LEFT JOIN payments p ON p.id = i.linked_payment_id
         LEFT JOIN members m ON m.id = p.member_id
         LEFT JOIN members pm ON pm.id = ${payeeSql("i")}
         ORDER BY i.received_at`,
      );
      return {
        title: this.title,
        columns: ["收到时间", "付款人", "金额", "备注", "原因", "处理", "关联到", "Venmo 交易编号", "钱在谁的账户"],
        rows: rows.map((i) => [
          at(i.received_at),
          i.payer_name ?? "",
          money(i.amount_cents),
          i.note ?? "",
          i.reason ?? "",
          INBOUND_STATE[i.state] ?? i.state,
          i.username ?? "",
          i.venmo_txn_id ?? "",
          person(i.payee_name),
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
  return `﻿${[t.columns, ...t.rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
