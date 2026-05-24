export type JarvysUser = {
  name: string;
  email: string;
  phone: string;
  plate: string;
};

const KEY = "jarvys_user";

export function saveUser(user: JarvysUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function loadUser(): JarvysUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JarvysUser;
  } catch {
    return null;
  }
}
