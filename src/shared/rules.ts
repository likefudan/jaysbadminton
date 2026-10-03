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

/** 给管理员的留言: optional. */
export function checkMessage(raw: string): string | null {
  return [...raw.trim()].length > MESSAGE_MAX ? `留言最多 ${MESSAGE_MAX} 个字` : null;
}

export function checkPassword(raw: string): string | null {
  if (raw.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  return null;
}
