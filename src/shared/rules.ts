// Validation rules shared by the Worker and the front end so both show the same messages.

export const USERNAME_MAX = 20;
export const NICKNAME_MAX = 30;
export const MESSAGE_MAX = 200;
export const PASSWORD_MIN = 8;

export function checkUsername(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "请填写用户名";
  if ([...name].length > USERNAME_MAX) return `用户名最多 ${USERNAME_MAX} 个字`;
  if (/\s/.test(name)) return "用户名不能包含空格";
  return null;
}

export function checkNickname(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "请填写微信名";
  if ([...name].length > NICKNAME_MAX) return `微信名最多 ${NICKNAME_MAX} 个字`;
  return null;
}

export const EMAIL_MAX = 100;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

/** An email address someone types in (registering, 找回链接, 个人信息). */
export function checkEmail(raw: string): string | null {
  const email = raw.trim();
  if (!email) return "请填写邮箱";
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return "邮箱格式不对";
  return null;
}

/** 给群主的留言: optional. */
export function checkMessage(raw: string): string | null {
  return [...raw.trim()].length > MESSAGE_MAX ? `留言最多 ${MESSAGE_MAX} 个字` : null;
}

export function checkPassword(raw: string): string | null {
  if (raw.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  return null;
}
