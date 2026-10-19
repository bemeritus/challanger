import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { GroupDetail, GroupRole, GroupSummary, User } from "../types";
import { useT, getLang } from "../i18n";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/// Shu haftaning kunlari (dushanbadan bugungacha)
function weekDaysSoFar(): string[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const out: string[] = [];
  for (let t = monday.getTime(); t <= now.getTime(); t += 86400000) out.push(ymd(new Date(t)));
  return out;
}

/// O'tgan haftaning to'liq kunlari (dushanba–yakshanba)
function prevWeekDays(): string[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(ymd(new Date(lastMonday.getTime() + i * 86400000)));
  return out;
}

/// Oxirgi `n` kun (eskidan yangiga), ISO sana formatida.
function lastNDays(n: number): string[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(ymd(new Date(now.getTime() - i * 86400000)));
  return out;
}

/// Backend javobini xavfsiz holatga keltiradi — eski API (massiv maydonlarsiz)
/// qaytarsa ham frontend qulamasligi uchun standart qiymatlar bilan to'ldiradi.
function normalizeDetail(d: GroupDetail): GroupDetail {
  return {
    ...d,
    emoji: d.emoji ?? "👥",
    description: d.description ?? "",
    my_role: d.my_role ?? "member",
    members: d.members ?? [],
    habits: d.habits ?? [],
    tasks: d.tasks ?? [],
    messages: d.messages ?? [],
    challenges: d.challenges ?? [],
    activity: d.activity ?? [],
  };
}

/// Berilgan bajarilgan kunlar to'plamidan bugungacha uzluksiz seriya (streak) uzunligi.
function currentStreak(days: Set<string>): number {
  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // Bugun belgilanmagan bo'lsa — kechadan boshlab sanaymiz (seriya hali uzilmagan).
  if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
  while (days.has(ymd(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function GroupsPage({ user }: { user: User }) {
  const t = useT();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  // Ochiq guruhni eslab qolamiz — sahifa yangilangandan keyin ham o'sha guruhda qolamiz.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => localStorage.getItem("challanger_group") || null
  );
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const loadGroups = () =>
    api.listGroups().then(setGroups).catch((e) => setError(String(e.message ?? e)));

  useEffect(() => {
    loadGroups();
  }, []);

  // Tanlangan guruhni saqlaymiz (yoki tozalaymiz).
  useEffect(() => {
    if (selectedId) localStorage.setItem("challanger_group", selectedId);
    else localStorage.removeItem("challanger_group");
  }, [selectedId]);

  // Saqlangan guruh endi mavjud bo'lmasa (o'chirilgan/chiqilgan) — ro'yxatga qaytamiz.
  useEffect(() => {
    if (selectedId && groups.length && !groups.some((g) => g.id === selectedId)) {
      setSelectedId(null);
    }
  }, [groups, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    api.getGroup(selectedId).then((d) => setDetail(normalizeDetail(d))).catch((e) => setError(String(e.message ?? e)));
  }, [selectedId]);

  const refreshDetail = () =>
    selectedId && api.getGroup(selectedId).then((d) => setDetail(normalizeDetail(d))).catch(() => {});

  // Real-vaqt: ochiq guruhga SSE bilan ulanamiz. Boshqa a'zo xabar yuborsa/o'chirsa
  // signal keladi va guruh detalini qayta yuklaymiz (chat jonli yangilanadi).
  // `EventSource` ulanish uzilsa o'zi qayta ulanadi.
  useEffect(() => {
    if (!selectedId) return;
    const es = new EventSource(api.groupEventsUrl(selectedId));
    es.onmessage = () => refreshDetail();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const g = await api.createGroup(newName.trim());
      setNewName("");
      await loadGroups();
      setSelectedId(g.id);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const joinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    try {
      const r = await api.joinGroup(joinCode.trim());
      setJoinCode("");
      await loadGroups();
      setSelectedId(r.group_id);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  if (selectedId && detail) {
    return (
      <GroupDetailView
        detail={detail}
        user={user}
        onBack={() => {
          setSelectedId(null);
          loadGroups();
        }}
        onChanged={refreshDetail}
        onLeftOrDeleted={() => {
          setSelectedId(null);
          loadGroups();
        }}
        setError={setError}
        error={error}
      />
    );
  }

  return (
    <div className="page groups-page">
      <div className="page-head">
        <h2>{t("groups.title")}</h2>
        <span className="page-hint">{t("groups.hint")}</span>
      </div>

      {error && (
        <div className="error-bar" onClick={() => setError(null)}>⚠️ {error}</div>
      )}

      <div className="group-actions">
        <form onSubmit={createGroup} className="group-action-card">
          <label>{t("groups.createNew")}</label>
          <div className="row">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("groups.groupName")} />
            <button type="submit" className="btn-primary">{t("groups.create")}</button>
          </div>
        </form>
        <form onSubmit={joinGroup} className="group-action-card">
          <label>{t("groups.joinWithCode")}</label>
          <div className="row">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder={t("groups.codePlaceholder")}
            />
            <button type="submit" className="btn-secondary">{t("groups.join")}</button>
          </div>
        </form>
      </div>

      <div className="group-list">
        {groups.length === 0 && <div className="empty">{t("groups.empty")}</div>}
        {groups.map((g) => (
          <button key={g.id} className="group-card" onClick={() => setSelectedId(g.id)}>
            <div className="group-card-main">
              <span className="group-name">
                <span className="group-emoji">{g.emoji}</span> {g.name}
              </span>
              <span className="group-meta">
                {t("groups.membersCount", { n: g.member_count })} · {g.role === "owner" ? t("groups.roleOwner") : g.role === "admin" ? t("groups.roleAdmin") : t("groups.roleMember")}
              </span>
            </div>
            <span className="group-arrow">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ================= Tafsilot + Statistika =================

interface DetailProps {
  detail: GroupDetail;
  user: User;
  onBack: () => void;
  onChanged: () => void;
  onLeftOrDeleted: () => void;
  setError: (s: string | null) => void;
  error: string | null;
}

type Tab = "habits" | "tasks" | "chat" | "challenges" | "stats" | "activity" | "members";
const TABS: Tab[] = ["habits", "tasks", "chat", "challenges", "stats", "activity", "members"];
const TAB_KEY = "challanger_group_tab";

function GroupDetailView({ detail, user, onBack, onChanged, onLeftOrDeleted, setError, error }: DetailProps) {
  const t = useT();
  // Faol tabni ham eslab qolamiz — yangilangach o'sha tabda qolamiz.
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem(TAB_KEY) as Tab | null;
    return saved && TABS.includes(saved) ? saved : "habits";
  });
  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
  }, [tab]);
  const [habitName, setHabitName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [taskName, setTaskName] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  const canManage = detail.my_role === "owner" || detail.my_role === "admin";
  const isOwner = detail.my_role === "owner";
  const today = ymd(new Date());
  const week = weekDaysSoFar();
  const nameOf = (uid: string | null) =>
    uid ? detail.members.find((m) => m.user_id === uid)?.username ?? "?" : "?";

  const addHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!habitName.trim()) return;
    try {
      await api.createGroupHabit(detail.id, { name: habitName.trim() });
      setHabitName("");
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const toggleHabit = async (hid: string) => {
    try {
      await api.toggleGroupHabit(hid, today);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const deleteHabit = async (hid: string) => {
    try {
      await api.deleteGroupHabit(detail.id, hid);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const react = async (hid: string, emoji: string) => {
    try {
      await api.reactGroupHabit(hid, emoji);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName.trim()) return;
    try {
      await api.createGroupTask(detail.id, { title: taskName.trim() });
      setTaskName("");
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const toggleTask = async (tid: string) => {
    try {
      await api.toggleGroupTask(tid);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const deleteTask = async (tid: string) => {
    try {
      await api.deleteGroupTask(tid);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const assignTask = async (tid: string, uid: string | null) => {
    try {
      await api.updateGroupTask(tid, { assigned_to: uid });
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = memberName.trim().toLowerCase();
    if (!u) return;
    try {
      await api.addGroupMember(detail.id, u);
      setMemberName("");
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const removeMember = async (uid: string) => {
    try {
      await api.removeGroupMember(detail.id, uid);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const setRole = async (uid: string, role: GroupRole) => {
    try {
      await api.setGroupMemberRole(detail.id, uid, role);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const nudge = async (uid: string) => {
    try {
      await api.nudgeMember(detail.id, uid);
      setError(null);
      alert(t("groups.nudgeSent"));
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(detail.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard yo'q — e'tiborsiz qoldiramiz */
    }
  };

  const regenCode = async () => {
    if (!confirm(t("groups.regenConfirm"))) return;
    try {
      await api.regenerateGroupCode(detail.id);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const leaveOrDelete = async () => {
    try {
      if (isOwner) await api.deleteGroup(detail.id);
      else await api.leaveGroup(detail.id);
      onLeftOrDeleted();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const doneToday = (hid: string) => {
    const h = detail.habits.find((x) => x.id === hid)!;
    return detail.members.filter((m) => (h.entries[m.user_id] ?? []).includes(today)).length;
  };
  const iDidToday = (hid: string) => {
    const h = detail.habits.find((x) => x.id === hid)!;
    return (h.entries[user.id] ?? []).includes(today);
  };
  // Joriy foydalanuvchining shu odatdagi seriyasi (streak)
  const myStreak = (hid: string) => {
    const h = detail.habits.find((x) => x.id === hid)!;
    return currentStreak(new Set(h.entries[user.id] ?? []));
  };

  // --- Statistika hisoblari ---
  const nDays = (days: string[]) =>
    detail.members.map((m) => {
      let count = 0;
      for (const h of detail.habits) {
        const set = new Set(h.entries[m.user_id] ?? []);
        for (const d of days) if (set.has(d)) count++;
      }
      return { ...m, count };
    });

  const week1 = week;
  const totalDone = nDays(week1).reduce((s, m) => s + m.count, 0);
  const possible = detail.members.length * detail.habits.length * week1.length;
  const rate = possible ? Math.round((totalDone / possible) * 100) : 0;

  // O'tgan hafta bilan solishtirish
  const prevWeek = prevWeekDays();
  const prevTotal = nDays(prevWeek).reduce((s, m) => s + m.count, 0);
  const delta = totalDone - prevTotal;

  return (
    <div className="page group-detail">
      <div className="page-head">
        <div className="gd-title">
          <button className="btn-back" onClick={onBack}>{t("groups.back")}</button>
          <h2>
            <span className="group-emoji">{detail.emoji}</span> {detail.name}
          </h2>
        </div>
        <button className="gd-code" onClick={copyCode} title={t("groups.copyTitle")}>
          🔑 {detail.invite_code}
          <span className="gd-code-hint">{copied ? t("groups.copied") : t("groups.copyHint")}</span>
        </button>
      </div>
      {detail.description && <p className="gd-desc">{detail.description}</p>}

      {error && <div className="error-bar" onClick={() => setError(null)}>⚠️ {error}</div>}

      <div className="seg gd-tabs">
        <button className={tab === "habits" ? "active" : ""} onClick={() => setTab("habits")}>{t("groups.tabHabits")}</button>
        <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>
          {t("groups.tabTasks")} ({detail.tasks.filter((task) => !task.done).length})
        </button>
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>{t("groups.tabChat")}</button>
        <button className={tab === "challenges" ? "active" : ""} onClick={() => setTab("challenges")}>{t("groups.tabChallenges")}</button>
        <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>{t("groups.tabStats")}</button>
        <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>{t("groups.tabActivity")}</button>
        <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>
          {t("groups.tabMembers")} ({detail.members.length})
        </button>
      </div>

      {/* ---- Odatlar ---- */}
      {tab === "habits" && (
        <div className="gd-section">
          <form className="habit-form-top gd-add" onSubmit={addHabit}>
            <input value={habitName} onChange={(e) => setHabitName(e.target.value)} placeholder={t("groups.addHabit")} />
            <button type="submit">{t("common.add")}</button>
          </form>

          {detail.habits.length === 0 && <div className="empty">{t("groups.noHabits")}</div>}
          {detail.habits.map((h) => {
            const dt = doneToday(h.id);
            const mine = iDidToday(h.id);
            const streak = myStreak(h.id);
            // Shu haftadagi jamoaviy bajarish (target progressi)
            const weekDone = detail.members.reduce((s, m) => {
              const set = new Set(h.entries[m.user_id] ?? []);
              return s + week.filter((d) => set.has(d)).length;
            }, 0);
            const weekTarget = h.target_per_week * detail.members.length;
            return (
              <div key={h.id} className="gh-card">
                <div className="gh-head">
                  <span className="habit-dot" style={{ background: h.color }} />
                  <span className="gh-name">{h.name}</span>
                  {streak > 0 && <span className="gh-streak" title={t("groups.streakDays", { n: streak })}>🔥 {streak}</span>}
                  <span className="gh-today">{t("groups.today", { done: dt, total: detail.members.length })}</span>
                  {canManage && (
                    <button className="habit-del" onClick={() => deleteHabit(h.id)} title={t("common.delete")}>×</button>
                  )}
                </div>
                <div className="gh-bar">
                  <div
                    className="gh-bar-fill"
                    style={{ width: `${(dt / Math.max(1, detail.members.length)) * 100}%`, background: h.color }}
                  />
                </div>
                <div className="gh-target">
                  {t("groups.targetProgress", { done: weekDone, target: weekTarget })}
                </div>
                <div className="gh-row">
                  <div className="gh-members">
                    {detail.members.map((m) => {
                      const did = (h.entries[m.user_id] ?? []).includes(today);
                      return (
                        <span
                          key={m.user_id}
                          className={`gh-avatar ${did ? "did" : ""}`}
                          style={did ? { background: h.color } : undefined}
                          title={`${m.username}${did ? " ✓" : ""}`}
                        >
                          {m.username.charAt(0).toUpperCase()}
                        </span>
                      );
                    })}
                  </div>
                  <button
                    className={`gh-toggle ${mine ? "done" : ""}`}
                    style={mine ? { background: h.color, borderColor: h.color } : undefined}
                    onClick={() => toggleHabit(h.id)}
                  >
                    {mine ? t("groups.done") : t("groups.iDid")}
                  </button>
                </div>
                <div className="gh-reactions">
                  {["👍", "🔥", "👏", "💪"].map((emoji) => {
                    const count = h.reactions?.[emoji] ?? 0;
                    const active = (h.my_reactions ?? []).includes(emoji);
                    return (
                      <button
                        key={emoji}
                        className={`reaction ${active ? "active" : ""}`}
                        onClick={() => react(h.id, emoji)}
                        title={t("groups.reactionTitle")}
                      >
                        {emoji}
                        {count > 0 && <span className="reaction-count">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Umumiy vazifalar ---- */}
      {tab === "tasks" && (
        <div className="gd-section">
          <form className="habit-form-top gd-add" onSubmit={addTask}>
            <input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder={t("groups.addTask")}
            />
            <button type="submit">{t("common.add")}</button>
          </form>
          {detail.tasks.length === 0 && <div className="empty">{t("groups.noTasks")}</div>}
          <div className="gtask-list">
            {detail.tasks.map((task) => (
              <div key={task.id} className={`gtask-row ${task.done ? "done" : ""}`}>
                <button className="gtask-check" onClick={() => toggleTask(task.id)}>
                  {task.done ? "✓" : ""}
                </button>
                <span className="gtask-title">{task.title}</span>
                {task.due_date && (
                  <span className="gtask-due">
                    📅 {new Date(task.due_date).toLocaleDateString(getLang(), { day: "numeric", month: "short" })}
                  </span>
                )}
                <select
                  className="gtask-assign"
                  value={task.assigned_to ?? ""}
                  onChange={(e) => assignTask(task.id, e.target.value || null)}
                  title={t("groups.assignTo")}
                >
                  <option value="">{t("groups.unassigned")}</option>
                  {detail.members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.username}</option>
                  ))}
                </select>
                {task.done && task.done_by && (
                  <span className="gtask-by">— {nameOf(task.done_by)}</span>
                )}
                <button className="gtask-del" onClick={() => deleteTask(task.id)} title={t("common.delete")}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Chat ---- */}
      {tab === "chat" && <ChatTab detail={detail} user={user} onChanged={onChanged} setError={setError} />}

      {/* ---- Challenge'lar ---- */}
      {tab === "challenges" && (
        <ChallengesTab detail={detail} canManage={canManage} onChanged={onChanged} setError={setError} />
      )}

      {/* ---- Faoliyat (bildirishnoma tasmasi) ---- */}
      {tab === "activity" && (
        <div className="gd-section">
          {detail.activity.length === 0 && <div className="empty">{t("groups.noActivity")}</div>}
          <div className="activity-feed">
            {detail.activity.map((a) => (
              <div key={a.id} className="activity-row">
                <span className="activity-text">{a.text}</span>
                <span className="activity-time">
                  {new Date(a.created_at).toLocaleString(getLang(), {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Statistika ---- */}
      {tab === "stats" && (
        <StatsTab detail={detail} user={user} rate={rate} totalDone={totalDone} prevTotal={prevTotal} delta={delta} />
      )}

      {/* ---- A'zolar ---- */}
      {tab === "members" && (
        <div className="gd-section">
          {isOwner && (
            <form className="habit-form-top gd-add" onSubmit={addMember}>
              <input
                value={memberName}
                onChange={(e) => setMemberName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                placeholder={t("groups.addMember")}
              />
              <button type="submit">{t("common.add")}</button>
            </form>
          )}
          <div className="member-list">
            {detail.members.map((m) => (
              <div key={m.user_id} className="member-row">
                <span className="avatar sm">{m.username.charAt(0).toUpperCase()}</span>
                <span className="member-name">{m.username}</span>
                {m.role === "owner" && <span className="member-badge">{t("groups.badgeOwner")}</span>}
                {m.role === "admin" && <span className="member-badge admin">{t("groups.badgeAdmin")}</span>}
                {m.user_id === user.id && <span className="member-you">{t("groups.youBadge")}</span>}
                {m.user_id !== user.id && (
                  <button className="member-nudge" onClick={() => nudge(m.user_id)} title={t("groups.nudgeTitle")}>👉</button>
                )}
                {isOwner && m.role !== "owner" && m.user_id !== user.id && (
                  <>
                    {m.role === "member" ? (
                      <button className="member-role" onClick={() => setRole(m.user_id, "admin")} title={t("groups.makeAdmin")}>⬆️</button>
                    ) : (
                      <button className="member-role" onClick={() => setRole(m.user_id, "member")} title={t("groups.removeAdmin")}>⬇️</button>
                    )}
                    <button
                      className="member-role"
                      onClick={() => confirm(t("groups.transferConfirm", { name: m.username })) && setRole(m.user_id, "owner")}
                      title={t("groups.makeOwner")}
                    >👑</button>
                    <button
                      className="member-kick"
                      title={t("groups.kickTitle")}
                      onClick={() => removeMember(m.user_id)}
                    >×</button>
                  </>
                )}
              </div>
            ))}
          </div>

          {canManage && <ProfileEditor detail={detail} onChanged={onChanged} setError={setError} />}

          {isOwner && (
            <button className="btn-secondary gd-regen" onClick={regenCode}>{t("groups.regenCode")}</button>
          )}

          <div className="gd-danger">
            {!confirmDel ? (
              <button className="btn-danger" onClick={() => setConfirmDel(true)}>
                {isOwner ? t("groups.deleteGroup") : t("groups.leaveGroup")}
              </button>
            ) : (
              <div className="confirm-row">
                <button className="btn-danger" onClick={leaveOrDelete}>
                  {isOwner ? t("groups.confirmDelete") : t("groups.confirmLeave")}
                </button>
                <button className="btn-secondary" onClick={() => setConfirmDel(false)}>{t("common.cancel")}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Chat tab ----------

function ChatTab({
  detail,
  user,
  onChanged,
  setError,
}: {
  detail: GroupDetail;
  user: User;
  onChanged: () => void;
  setError: (s: string | null) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const canModerate = detail.my_role === "owner" || detail.my_role === "admin";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail.messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.sendGroupMessage(detail.id, text.trim());
      setText("");
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const del = async (mid: string) => {
    try {
      await api.deleteGroupMessage(mid);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  return (
    <div className="gd-section chat-tab">
      <div className="chat-messages">
        {detail.messages.length === 0 && <div className="empty">{t("groups.noMessages")}</div>}
        {detail.messages.map((m) => {
          const mine = m.user_id === user.id;
          return (
            <div key={m.id} className={`chat-msg ${mine ? "mine" : ""}`}>
              {!mine && <span className="chat-author">{m.username}</span>}
              <span className="chat-text">{m.text}</span>
              <span className="chat-time">
                {new Date(m.created_at).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit" })}
              </span>
              {(mine || canModerate) && (
                <button className="chat-del" onClick={() => del(m.id)} title={t("common.delete")}>×</button>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form className="chat-form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("groups.chatPlaceholder")} maxLength={1000} />
        <button type="submit" className="btn-primary">{t("groups.sendMsg")}</button>
      </form>
    </div>
  );
}

// ---------- Challenge tab ----------

function ChallengesTab({
  detail,
  canManage,
  onChanged,
  setError,
}: {
  detail: GroupDetail;
  canManage: boolean;
  onChanged: () => void;
  setError: (s: string | null) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(ymd(new Date()));
  const [end, setEnd] = useState(ymd(new Date(Date.now() + 7 * 86400000)));
  const todayStr = ymd(new Date());

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.createChallenge(detail.id, { title: title.trim(), start_date: start, end_date: end });
      setTitle("");
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const del = async (cid: string) => {
    try {
      await api.deleteChallenge(cid);
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  // Challenge davomidagi bajarishlar bo'yicha reyting
  const scores = (startD: string, endD: string) => {
    const days: string[] = [];
    for (let d = new Date(startD); ymd(d) <= endD && ymd(d) <= todayStr; d.setDate(d.getDate() + 1)) {
      days.push(ymd(d));
    }
    return detail.members
      .map((m) => {
        let count = 0;
        for (const h of detail.habits) {
          const set = new Set(h.entries[m.user_id] ?? []);
          for (const d of days) if (set.has(d)) count++;
        }
        return { ...m, count };
      })
      .sort((a, b) => b.count - a.count);
  };

  const daysLeft = (endD: string) =>
    Math.max(0, Math.ceil((new Date(endD).getTime() - new Date(todayStr).getTime()) / 86400000));

  return (
    <div className="gd-section">
      {canManage && (
        <form className="challenge-form" onSubmit={add}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("groups.challengeTitle")} />
          <div className="row">
            <label>{t("groups.challengeStart")}<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label>{t("groups.challengeEnd")}<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <button type="submit" className="btn-primary">{t("groups.challengeCreate")}</button>
        </form>
      )}

      {detail.challenges.length === 0 && <div className="empty">{t("groups.noChallenges")}</div>}
      {detail.challenges.map((c) => {
        const status =
          todayStr < c.start_date ? "upcoming" : todayStr > c.end_date ? "ended" : "active";
        const board = scores(c.start_date, c.end_date);
        const leader = board[0];
        const max = board[0]?.count || 1;
        return (
          <div key={c.id} className={`challenge-card ${status}`}>
            <div className="challenge-head">
              <span className="challenge-name">🏁 {c.title}</span>
              <span className={`challenge-status ${status}`}>
                {status === "active" && t("groups.daysLeft", { n: daysLeft(c.end_date) })}
                {status === "upcoming" && t("groups.challengeUpcoming")}
                {status === "ended" && t("groups.challengeEnded")}
              </span>
              {canManage && <button className="habit-del" onClick={() => del(c.id)} title={t("common.delete")}>×</button>}
            </div>
            <div className="challenge-dates">
              {new Date(c.start_date).toLocaleDateString(getLang(), { day: "numeric", month: "short" })} –{" "}
              {new Date(c.end_date).toLocaleDateString(getLang(), { day: "numeric", month: "short" })}
            </div>
            {leader && status !== "upcoming" && (
              <div className="challenge-leader">
                {status === "ended" ? "🏆" : "🥇"} {t("groups.challengeLeader", { name: leader.username, n: leader.count })}
              </div>
            )}
            {status !== "upcoming" && (
              <div className="leaderboard mini">
                {board.slice(0, 5).map((m, i) => (
                  <div key={m.user_id} className="lb-row">
                    <span className="lb-rank">{i + 1}</span>
                    <span className="lb-name">{m.username}</span>
                    <div className="lb-bar"><div className="lb-bar-fill" style={{ width: `${(m.count / max) * 100}%` }} /></div>
                    <span className="lb-count">{m.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Statistika tab (leaderboard davrlari + heatmap + badge) ----------

function StatsTab({
  detail,
  user,
  rate,
  totalDone,
  prevTotal,
  delta,
}: {
  detail: GroupDetail;
  user: User;
  rate: number;
  totalDone: number;
  prevTotal: number;
  delta: number;
}) {
  const t = useT();
  const [period, setPeriod] = useState<"week" | "month" | "all">("week");
  const today = ymd(new Date());

  const periodDays = period === "week" ? 7 : period === "month" ? 30 : 90;
  const days = lastNDays(periodDays);

  const leaderboard = detail.members
    .map((m) => {
      let count = 0;
      let best = 0;
      for (const h of detail.habits) {
        const set = new Set(h.entries[m.user_id] ?? []);
        for (const d of days) if (set.has(d)) count++;
        best = Math.max(best, currentStreak(set));
      }
      return { ...m, count, streak: best };
    })
    .sort((a, b) => b.count - a.count);
  const maxCount = leaderboard[0]?.count || 1;

  // Badge (yutuq) hisoblari — joriy foydalanuvchi uchun
  const myBest = leaderboard.find((m) => m.user_id === user.id)?.streak ?? 0;
  const iAmTop = leaderboard[0]?.user_id === user.id && (leaderboard[0]?.count ?? 0) > 0;
  const week = weekDaysSoFar();
  const perfectWeek =
    detail.habits.length > 0 &&
    detail.habits.every((h) => {
      const set = new Set(h.entries[user.id] ?? []);
      return week.every((d) => set.has(d));
    });
  const badges: { icon: string; label: string }[] = [];
  if (myBest >= 30) badges.push({ icon: "💎", label: t("groups.badgeStreak30") });
  else if (myBest >= 7) badges.push({ icon: "🔥", label: t("groups.badgeStreak7") });
  if (perfectWeek) badges.push({ icon: "💯", label: t("groups.badgePerfectWeek") });
  if (iAmTop) badges.push({ icon: "🥇", label: t("groups.badgeTopWeek") });

  // Guruh heatmap'i — oxirgi 90 kun, kunlik bajarish zichligi
  const heatDays = lastNDays(91);
  const perDay = (d: string) => {
    let c = 0;
    for (const h of detail.habits) {
      for (const m of detail.members) {
        if ((h.entries[m.user_id] ?? []).includes(d)) c++;
      }
    }
    return c;
  };
  const heatMax = Math.max(1, ...heatDays.map(perDay));

  const doneToday = (hid: string) => {
    const h = detail.habits.find((x) => x.id === hid)!;
    return detail.members.filter((m) => (h.entries[m.user_id] ?? []).includes(today)).length;
  };

  return (
    <div className="gd-section">
      <div className="stat-tiles">
        <div className="stat-tile">
          <div className="stat-num">{rate}%</div>
          <div className="stat-label">{t("groups.rateLabel")}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-num">{totalDone}</div>
          <div className="stat-label">{t("groups.totalWeek")}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-num">{detail.habits.length}</div>
          <div className="stat-label">{t("groups.groupHabits")}</div>
        </div>
      </div>

      {badges.length > 0 && (
        <>
          <h3 className="stat-h">{t("groups.badges")}</h3>
          <div className="badge-row">
            {badges.map((b, i) => (
              <span key={i} className="badge-chip" title={b.label}>{b.icon} {b.label}</span>
            ))}
          </div>
        </>
      )}

      <div className="week-summary">
        <span>{t("groups.weekSummary")}</span>
        <span className="ws-cur">{t("groups.thisWeekN", { n: totalDone })}</span>
        <span className="ws-prev">{t("groups.prevWeekN", { n: prevTotal })}</span>
        {delta !== 0 && (
          <span className={`ws-delta ${delta > 0 ? "up" : "down"}`}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        )}
        {delta === 0 && <span className="ws-delta">{t("groups.equal")}</span>}
      </div>

      <div className="stat-head-row">
        <h3 className="stat-h">{t("groups.leaderboard")}</h3>
        <div className="seg sm">
          <button className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>{t("groups.periodWeek")}</button>
          <button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>{t("groups.periodMonth")}</button>
          <button className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>{t("groups.periodAll")}</button>
        </div>
      </div>
      <div className="leaderboard">
        {leaderboard.map((m, i) => (
          <div key={m.user_id} className="lb-row">
            <span className="lb-rank">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span>
            <span className="avatar sm">{m.username.charAt(0).toUpperCase()}</span>
            <span className="lb-name">
              {m.username}
              {m.user_id === user.id && ` ${t("groups.you")}`}
              {m.streak > 0 && <span className="lb-streak"> 🔥{m.streak}</span>}
            </span>
            <div className="lb-bar">
              <div className="lb-bar-fill" style={{ width: `${(m.count / maxCount) * 100}%` }} />
            </div>
            <span className="lb-count">{m.count}</span>
          </div>
        ))}
      </div>

      <h3 className="stat-h">{t("groups.last90")}</h3>
      <div className="heatmap">
        {heatDays.map((d) => {
          const v = perDay(d);
          const intensity = v === 0 ? 0 : Math.ceil((v / heatMax) * 4);
          return <span key={d} className={`heat-cell h${intensity}`} title={`${d}: ${v}`} />;
        })}
      </div>

      <h3 className="stat-h">{t("groups.todayStatus")}</h3>
      <div className="stat-list">
        {detail.habits.map((h) => {
          const dt = doneToday(h.id);
          return (
            <div key={h.id} className="stat-hrow">
              <span className="habit-dot" style={{ background: h.color }} />
              <span className="stat-hname">{h.name}</span>
              <div className="gh-bar">
                <div className="gh-bar-fill" style={{ width: `${(dt / Math.max(1, detail.members.length)) * 100}%`, background: h.color }} />
              </div>
              <span className="stat-hcount">{dt}/{detail.members.length}</span>
            </div>
          );
        })}
        {detail.habits.length === 0 && <div className="empty">{t("groups.noHabit")}</div>}
      </div>
    </div>
  );
}

// ---------- Profil tahriri ----------

function ProfileEditor({
  detail,
  onChanged,
  setError,
}: {
  detail: GroupDetail;
  onChanged: () => void;
  setError: (s: string | null) => void;
}) {
  const t = useT();
  const [name, setName] = useState(detail.name);
  const [emoji, setEmoji] = useState(detail.emoji);
  const [description, setDescription] = useState(detail.description);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateGroup(detail.id, { name, emoji, description });
      onChanged();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  return (
    <form className="profile-editor" onSubmit={save}>
      <h3 className="stat-h">{t("groups.editProfile")}</h3>
      <div className="row">
        <input className="emoji-input" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} title={t("groups.groupEmoji")} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groups.groupName")} />
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("groups.descPlaceholder")} maxLength={500} rows={2} />
      <button type="submit" className="btn-secondary">{t("groups.saveProfile")}</button>
    </form>
  );
}
