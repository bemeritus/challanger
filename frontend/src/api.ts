import type { GroupChallenge, GroupDetail, GroupHabit, GroupMessage, GroupRole, GroupSummary, GroupTask, Habit, Project, Subtask, Task, User } from "./types";

const BASE = "/api";
const TOKEN_KEY = "challanger_token";
const REFRESH_KEY = "challanger_refresh";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setTokens: (token: string, refresh: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/// 401 bo'lganda chaqiriladigan handler (App o'rnatadi)
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

// Bir vaqtda faqat bitta refresh so'rovi ketishini ta'minlaydi (shu tab ichida).
let refreshing: Promise<boolean> | null = null;

// Refresh tokenni yangilaydi. `prevToken` — muvaffaqiyatsiz so'rov ishlatgan access token;
// agar boshqa tab allaqachon yangilagan bo'lsa (token o'zgargan), qayta so'ramaymiz.
async function refreshOnce(prevToken: string | null): Promise<boolean> {
  // Boshqa tab allaqachon yangilagan bo'lsa — refresh tokenni sarflamaymiz.
  if (prevToken && tokenStore.get() && tokenStore.get() !== prevToken) return true;
  const refresh = tokenStore.getRefresh();
  if (!refresh) return false;
  try {
    const res = await fetch(BASE + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) {
      // So'rov o'tmadi — ehtimol boshqa tab bu tokenni allaqachon aylantirgan.
      return !!(prevToken && tokenStore.get() && tokenStore.get() !== prevToken);
    }
    const data = (await res.json()) as { token: string; refresh_token: string };
    tokenStore.setTokens(data.token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// Tablar orasida ham serializatsiya: Web Locks mavjud bo'lsa bitta tab bir vaqtda
// yangilaydi, qolganlari kutib turib yangi tokenni oladi (spurious logout'ning oldini oladi).
async function doRefresh(prevToken: string | null): Promise<boolean> {
  const nav = navigator as Navigator & { locks?: LockManager };
  if (nav.locks?.request) {
    return nav.locks.request("challanger-refresh", () => refreshOnce(prevToken));
  }
  return refreshOnce(prevToken);
}

function ensureRefresh(prevToken: string | null): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh(prevToken).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function req<T>(path: string, options?: RequestInit, retry = false): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(BASE + path, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    // Access token muddati o'tgan bo'lsa — refresh token bilan bir marta yangilaymiz.
    if (!retry && path !== "/auth/refresh" && tokenStore.getRefresh()) {
      const ok = await ensureRefresh(token);
      if (ok) return req<T>(path, options, true);
    }
    onUnauthorized?.();
    throw new Error("avtorizatsiya talab qilinadi");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "so'rov xatosi");
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export interface TaskFilters {
  project_id?: string;
  completed?: boolean;
  view?: "today" | "upcoming" | "overdue";
  search?: string;
  tag?: string;
  priority?: number;
  limit?: number;
  offset?: number;
}

interface AuthResponse {
  token: string;
  refresh_token: string;
  user: User;
}

export interface PomodoroStats {
  today: number;
  total: number;
  minutes_total: number;
  last30: { day: string; count: number; minutes: number }[];
}

export const api = {
  // --- Auth ---
  signup: (data: { username: string; email: string; password: string }) =>
    req<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    req<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(data) }),
  logout: (refresh_token: string) =>
    req<{ ok: boolean }>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token }),
    }),
  me: () => req<User>("/auth/me"),
  updateProfile: (data: { username?: string; email?: string }) =>
    req<User>("/auth/me", { method: "PATCH", body: JSON.stringify(data) }),
  changePassword: (data: { current_password: string; new_password: string }) =>
    req<{ ok: boolean }>("/auth/password", { method: "POST", body: JSON.stringify(data) }),
  deleteAccount: () => req<{ ok: boolean }>("/auth/me", { method: "DELETE" }),

  // --- Telegram ---
  telegramStatus: () =>
    req<{ configured: boolean; connected: boolean }>("/telegram/status"),
  telegramLink: () =>
    req<{ deep_link: string; bot_username: string; code: string }>("/telegram/link", {
      method: "POST",
    }),
  telegramUnlink: () => req<{ ok: boolean }>("/telegram/unlink", { method: "POST" }),

  // --- Web Push ---
  pushVapidKey: () => req<{ key: string }>("/push/vapid"),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    req<{ ok: boolean }>("/push/subscribe", { method: "POST", body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string) =>
    req<{ ok: boolean }>("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),

  // --- Kalendar feed (iCal / webcal obuna) ---
  calendarEnable: () => req<{ path: string | null }>("/calendar/token", { method: "POST" }),
  calendarRegenerate: () => req<{ path: string | null }>("/calendar/token", { method: "DELETE" }),

  // --- Pomodoro ---
  recordPomodoro: (data: { kind: "work" | "short" | "long"; seconds: number }) =>
    req<{ ok: boolean; today: number }>("/pomodoro", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  pomodoroStats: () => req<PomodoroStats>("/pomodoro"),

  // --- Loyihalar ---
  listProjects: () => req<Project[]>("/projects"),
  createProject: (data: { name: string; color?: string }) =>
    req<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: Partial<Project>) =>
    req<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    req<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),

  // --- Vazifalar ---
  listTasks: (filters: TaskFilters = {}) => {
    const p = new URLSearchParams();
    if (filters.project_id) p.set("project_id", filters.project_id);
    if (filters.completed !== undefined) p.set("completed", String(filters.completed));
    if (filters.view) p.set("view", filters.view);
    if (filters.search) p.set("search", filters.search);
    if (filters.tag) p.set("tag", filters.tag);
    if (filters.priority !== undefined) p.set("priority", String(filters.priority));
    if (filters.limit !== undefined) p.set("limit", String(filters.limit));
    if (filters.offset !== undefined) p.set("offset", String(filters.offset));
    const qs = p.toString();
    return req<Task[]>(`/tasks${qs ? `?${qs}` : ""}`);
  },
  createTask: (data: Partial<Task>) =>
    req<Task>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  reorderTasks: (ids: string[]) =>
    req<{ ok: boolean }>("/tasks/reorder", { method: "POST", body: JSON.stringify({ ids }) }),
  updateTask: (id: string, data: Partial<Task>) =>
    req<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  completeTask: (id: string) =>
    req<Task>(`/tasks/${id}/complete`, { method: "POST" }),
  deleteTask: (id: string) =>
    // keepalive — sahifa yopilayotganda ham so'rov yuborilib ulguradi.
    req<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE", keepalive: true }),

  // --- Kichik qadamlar (subtasks) ---
  listSubtasks: () => req<Subtask[]>("/subtasks"),
  createSubtask: (taskId: string, title: string) =>
    req<Subtask>(`/tasks/${taskId}/subtasks`, { method: "POST", body: JSON.stringify({ title }) }),
  updateSubtask: (id: string, data: Partial<Pick<Subtask, "title" | "done" | "position">>) =>
    req<Subtask>(`/subtasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSubtask: (id: string) =>
    req<{ ok: boolean }>(`/subtasks/${id}`, { method: "DELETE" }),

  // --- Odatlar (habit tracker) ---
  listHabits: () => req<Habit[]>("/habits"),
  createHabit: (data: {
    name: string;
    color?: string;
    frequency?: "daily" | "weekly";
    target_per_week?: number;
    duration_days?: number;
    end_date?: string | null;
  }) => req<Habit>("/habits", { method: "POST", body: JSON.stringify(data) }),
  updateHabit: (id: string, data: Partial<Habit>) =>
    req<Habit>(`/habits/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteHabit: (id: string) =>
    req<{ ok: boolean }>(`/habits/${id}`, { method: "DELETE" }),
  toggleHabit: (id: string, day: string) =>
    req<{ day: string; done: boolean }>(`/habits/${id}/toggle`, {
      method: "POST",
      body: JSON.stringify({ day }),
    }),

  // --- Jamoa (groupwork) ---
  listGroups: () => req<GroupSummary[]>("/groups"),
  createGroup: (name: string) =>
    req<GroupSummary>("/groups", { method: "POST", body: JSON.stringify({ name }) }),
  joinGroup: (code: string) =>
    req<{ ok: boolean; group_id: string }>("/groups/join", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  getGroup: (id: string) => req<GroupDetail>(`/groups/${id}`),
  updateGroup: (id: string, data: { name?: string; emoji?: string; description?: string }) =>
    req<{ ok: boolean }>(`/groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  regenerateGroupCode: (id: string) =>
    req<{ invite_code: string }>(`/groups/${id}/regenerate`, { method: "POST" }),
  deleteGroup: (id: string) => req<{ ok: boolean }>(`/groups/${id}`, { method: "DELETE" }),
  leaveGroup: (id: string) =>
    req<{ ok: boolean }>(`/groups/${id}/leave`, { method: "POST" }),
  addGroupMember: (id: string, username: string) =>
    req<{ ok: boolean }>(`/groups/${id}/members`, {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  removeGroupMember: (id: string, uid: string) =>
    req<{ ok: boolean }>(`/groups/${id}/members/${uid}`, { method: "DELETE" }),
  setGroupMemberRole: (id: string, uid: string, role: GroupRole) =>
    req<{ ok: boolean }>(`/groups/${id}/members/${uid}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
  nudgeMember: (id: string, userId: string, habitName?: string) =>
    req<{ ok: boolean }>(`/groups/${id}/nudge`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, habit_name: habitName }),
    }),
  createGroupHabit: (
    id: string,
    data: { name: string; color?: string; frequency?: "daily" | "weekly"; target_per_week?: number }
  ) => req<GroupHabit>(`/groups/${id}/habits`, { method: "POST", body: JSON.stringify(data) }),
  deleteGroupHabit: (id: string, hid: string) =>
    req<{ ok: boolean }>(`/groups/${id}/habits/${hid}`, { method: "DELETE" }),
  toggleGroupHabit: (hid: string, day: string) =>
    req<{ day: string; done: boolean }>(`/group-habits/${hid}/toggle`, {
      method: "POST",
      body: JSON.stringify({ day }),
    }),
  reactGroupHabit: (hid: string, emoji: string) =>
    req<{ emoji: string; active: boolean }>(`/group-habits/${hid}/react`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),
  createGroupTask: (
    id: string,
    data: { title: string; assigned_to?: string | null; due_date?: string | null; reminder_at?: string | null }
  ) => req<GroupTask>(`/groups/${id}/tasks`, { method: "POST", body: JSON.stringify(data) }),
  updateGroupTask: (
    tid: string,
    data: { assigned_to?: string | null; due_date?: string | null; reminder_at?: string | null }
  ) => req<GroupTask>(`/group-tasks/${tid}`, { method: "PATCH", body: JSON.stringify(data) }),
  toggleGroupTask: (tid: string) =>
    req<GroupTask>(`/group-tasks/${tid}/toggle`, { method: "POST" }),
  deleteGroupTask: (tid: string) =>
    req<{ ok: boolean }>(`/group-tasks/${tid}`, { method: "DELETE" }),

  // --- Guruh chati ---
  sendGroupMessage: (id: string, text: string) =>
    req<GroupMessage>(`/groups/${id}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  deleteGroupMessage: (mid: string) =>
    req<{ ok: boolean }>(`/group-messages/${mid}`, { method: "DELETE" }),
  // Guruh real-vaqt hodisalari uchun SSE URL. `EventSource` header qo'ya olmagani
  // uchun access token query orqali uzatiladi.
  groupEventsUrl: (id: string) =>
    `${BASE}/groups/${id}/events?token=${encodeURIComponent(tokenStore.get() ?? "")}`,

  // --- Guruh challenge'lari ---
  createChallenge: (id: string, data: { title: string; start_date: string; end_date: string }) =>
    req<GroupChallenge>(`/groups/${id}/challenges`, { method: "POST", body: JSON.stringify(data) }),
  deleteChallenge: (cid: string) =>
    req<{ ok: boolean }>(`/group-challenges/${cid}`, { method: "DELETE" }),
};
