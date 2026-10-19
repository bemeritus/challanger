import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useT } from "./i18n";
import { useFeatures } from "./features";
import { Icon } from "./components/Icon";
import { parseTask } from "./nlp";
import type { Habit, Project, Subtask, Task, User } from "./types";
import { Sidebar, type Selection } from "./components/Sidebar";
import { TaskItem } from "./components/TaskItem";
import { TaskDetail } from "./components/TaskDetail";
import { CalendarPage } from "./components/CalendarPage";
import { EisenhowerPage } from "./components/EisenhowerPage";
import { HabitsPage } from "./components/HabitsPage";
import { PomodoroPage } from "./components/PomodoroPage";
import { CountdownPage } from "./components/CountdownPage";
import { GroupsPage } from "./components/GroupsPage";
import { SettingsPage } from "./components/SettingsPage";
import { CommandPalette } from "./components/CommandPalette";
import { StatsPage } from "./components/StatsPage";

interface Props {
  user: User;
  onLogout: () => void;
  onUserUpdate: (u: User) => void;
}

// Joriy sahifa/tanlovni sahifa yangilangandan keyin ham eslab qolish uchun localStorage.
const SELECTION_KEY = "challanger_selection";
const DEFAULT_SELECTION: Selection = { kind: "smart", view: "today" };

function loadSelection(): Selection {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (!raw) return DEFAULT_SELECTION;
    const s = JSON.parse(raw) as Selection;
    if (s && (s.kind === "smart" || s.kind === "project" || s.kind === "page")) return s;
  } catch {
    /* buzilgan qiymat — standartga qaytamiz */
  }
  return DEFAULT_SELECTION;
}

export default function Workspace({ user, onLogout, onUserUpdate }: Props) {
  const t = useT();
  const { isEnabled } = useFeatures();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [selection, setSelection] = useState<Selection>(loadSelection);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Mobil: sidebar off-canvas drawer holati
  const [navOpen, setNavOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [quick, setQuick] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"smart" | "manual">("smart");
  const [error, setError] = useState<string | null>(null);
  // Drag-and-drop holati
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Undo (o'chirishni 5 soniya kechiktirish)
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kutilayotgan o'chirish id'si — unmount/sahifa yopilishida yakunlash uchun (state emas, ref).
  const pendingDeleteId = useRef<string | null>(null);

  // Barcha ro'yxatlarni serverdan qayta yuklaydi (jonli yangilanish uchun).
  const reload = useCallback(() => {
    // Undo (o'chirish) oynasi ochiq bo'lsa yangilamaymiz — o'chirilayotgan vazifa qaytib kelmasligi uchun.
    if (pendingDeleteId.current) return;
    Promise.all([api.listProjects(), api.listTasks(), api.listHabits(), api.listSubtasks()])
      .then(([p, t, h, s]) => {
        setProjects(p);
        setTasks(t);
        setHabits(h);
        setSubtasks(s);
      })
      .catch(() => {
        /* jonli yangilanish — xatoni jim o'tkazamiz (keyingi urinishda qayta sinaydi) */
      });
  }, []);

  // Dastlabki yuklash (xatoni ko'rsatamiz)
  useEffect(() => {
    Promise.all([api.listProjects(), api.listTasks(), api.listHabits(), api.listSubtasks()])
      .then(([p, t, h, s]) => {
        setProjects(p);
        setTasks(t);
        setHabits(h);
        setSubtasks(s);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // Jonli yangilanish: oyna fokusga qaytganda, ko'rinadigan bo'lganda va har 45s.
  useEffect(() => {
    const onFocus = () => reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 45000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [reload]);

  // Tanlovni saqlab turamiz — sahifa yangilangandan keyin ham o'sha joyda qolamiz.
  useEffect(() => {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
    } catch {
      /* localStorage mavjud emas/to'la — jim o'tamiz */
    }
  }, [selection]);

  // Saqlangan tanlov o'chirilgan loyihaga ishora qilsa (boshqa qurilmada o'chirilgan
  // bo'lishi mumkin) — standart ko'rinishga qaytamiz.
  useEffect(() => {
    if (
      selection.kind === "project" &&
      projects.length > 0 &&
      !projects.some((p) => p.id === selection.id)
    ) {
      setSelection(DEFAULT_SELECTION);
    }
  }, [projects, selection]);

  // Brauzer bildirishnomalariga ruxsat
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Eslatmalarni kuzatish (har 30 soniyada)
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const task of tasks) {
        if (task.completed || !task.reminder_at) continue;
        const at = new Date(task.reminder_at).getTime();
        const key = `${task.id}:${task.reminder_at}`;
        if (at <= now && at > now - 3600_000 && !notified.current.has(key)) {
          notified.current.add(key);
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(t("main.reminderTitle"), { body: task.title });
          }
        }
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [tasks]);

  // Tanlovga qarab filtrlangan ro'yxat
  const visible = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + 86400000);

    const completedView = selection.kind === "smart" && selection.view === "completed";
    let list = completedView
      ? tasks.filter((t) => t.completed)
      : tasks.filter((t) => showCompleted || !t.completed);

    if (tagFilter) list = list.filter((t) => (t.tags ?? []).includes(tagFilter));

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.notes ?? "").toLowerCase().includes(q) ||
          (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      );
    }

    if (selection.kind === "project") {
      list = list.filter((t) => t.project_id === selection.id);
    } else if (selection.kind === "smart" && selection.view === "today") {
      list = list.filter(
        (t) => t.due_date && new Date(t.due_date) < endOfToday && !t.completed
      );
    } else if (selection.kind === "smart" && selection.view === "upcoming") {
      list = list.filter(
        (t) => t.due_date && new Date(t.due_date) >= endOfToday && !t.completed
      );
    }

    // Bajarilganlar ro'yxati — eng oxirgi bajarilgani birinchi.
    if (completedView) {
      list = [...list].sort(
        (a, b) =>
          new Date(b.completed_at ?? 0).getTime() - new Date(a.completed_at ?? 0).getTime()
      );
    } else if (sortMode === "manual") {
      // "Qo'lda" rejimda faqat position bo'yicha (drag-and-drop tartibi hokim).
      list = [...list].sort((a, b) => a.position - b.position);
    }
    return list;
  }, [tasks, selection, showCompleted, tagFilter, search, sortMode]);

  const counts = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + 86400000);
    const active = tasks.filter((t) => !t.completed);
    const byProject: Record<string, number> = {};
    for (const t of active) {
      if (t.project_id) byProject[t.project_id] = (byProject[t.project_id] ?? 0) + 1;
    }
    return {
      today: active.filter((t) => t.due_date && new Date(t.due_date) < endOfToday).length,
      upcoming: active.filter((t) => t.due_date && new Date(t.due_date) >= endOfToday).length,
      all: active.length,
      completed: tasks.length - active.length,
      byProject,
    };
  }, [tasks]);

  const subtaskCounts = useMemo(() => {
    const m: Record<string, { done: number; total: number }> = {};
    for (const s of subtasks) {
      const c = m[s.task_id] ?? { done: 0, total: 0 };
      c.total++;
      if (s.done) c.done++;
      m[s.task_id] = c;
    }
    return m;
  }, [subtasks]);

  const selectAndClear = (s: Selection) => {
    setSelection(s);
    setSelectedId(null);
  };

  // Klaviatura yorliqlari (vazifalar ro'yxatida)
  const quickRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (typing) return;
      // Faqat vazifalar ko'rinishida navigatsiya ishlaydi
      if (selection.kind === "page") {
        if (e.key === "/" && quickRef.current) quickRef.current.focus();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        quickRef.current?.focus();
        return;
      }

      const ids = visible.map((t) => t.id);
      const cur = selectedId ? ids.indexOf(selectedId) : -1;

      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          const next = cur < 0 ? 0 : Math.min(cur + 1, ids.length - 1);
          if (ids[next]) setSelectedId(ids[next]);
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prev = cur < 0 ? 0 : Math.max(cur - 1, 0);
          if (ids[prev]) setSelectedId(ids[prev]);
          break;
        }
        case "c":
        case "x":
          if (selectedId) {
            e.preventDefault();
            const sel = tasks.find((t) => t.id === selectedId);
            if (sel?.completed) reopenTask(selectedId);
            else completeTask(selectedId);
          }
          break;
        case "Delete":
        case "Backspace":
          if (selectedId) {
            e.preventDefault();
            removeTask(selectedId);
          }
          break;
        case "Escape":
          setSelectedId(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedId, selection]);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const selectedSubtasks = useMemo(
    () => subtasks.filter((s) => s.task_id === selectedId),
    [subtasks, selectedId]
  );

  // ---- Mutatsiyalar ----
  const upsertTask = (t: Task) =>
    setTasks((prev) => {
      const i = prev.findIndex((x) => x.id === t.id);
      if (i === -1) return [...prev, t];
      const copy = [...prev];
      copy[i] = t;
      return copy;
    });

  const addQuickTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = quick.trim();
    if (!raw) return;
    setQuick("");
    // Tabiiy tildan muddat/prioritet/teg ajratib olamiz
    const parsed = parseTask(raw);
    const defaults: Partial<Task> & { tags?: string[] } = {};
    if (selection.kind === "project") defaults.project_id = selection.id;
    if (parsed.priority > 0) defaults.priority = parsed.priority;
    if (parsed.tags.length) defaults.tags = parsed.tags;
    if (parsed.due_date) {
      defaults.due_date = parsed.due_date;
    } else if (selection.kind === "smart" && selection.view === "today") {
      const d = new Date();
      d.setHours(23, 59, 0, 0);
      defaults.due_date = d.toISOString();
    }
    try {
      const created = await api.createTask({ title: parsed.title, ...defaults });
      upsertTask(created);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const patchTask = async (id: string, patch: Partial<Task>) => {
    try {
      const updated = await api.updateTask(id, patch);
      upsertTask(updated);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const completeTask = async (id: string) => {
    try {
      const updated = await api.completeTask(id);
      upsertTask(updated);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  // Bajarilgan vazifani qayta ochish (belgini olib tashlash).
  const reopenTask = async (id: string) => {
    try {
      const updated = await api.updateTask(id, { completed: false });
      upsertTask(updated);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  // O'chirish 5 soniyaga kechiktiriladi — shu vaqt ichida "Bekor qilish" mumkin.
  const removeTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    // Avvalgi kutilayotgan o'chirish bo'lsa — uni darhol serverdan o'chiramiz.
    flushPendingDelete();
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (selectedId === id) setSelectedId(null);
    setPendingDelete(task);
    pendingDeleteId.current = id;
    deleteTimer.current = setTimeout(() => {
      api.deleteTask(id).catch((e) => setError(String(e.message ?? e)));
      setPendingDelete(null);
      pendingDeleteId.current = null;
      deleteTimer.current = null;
    }, 5000);
  };

  // Kutilayotgan o'chirishni darhol serverga yuborish (kechikmasdan).
  const flushPendingDelete = () => {
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
    if (pendingDeleteId.current) {
      api.deleteTask(pendingDeleteId.current).catch((e) => setError(String(e.message ?? e)));
      pendingDeleteId.current = null;
      setPendingDelete(null);
    }
  };

  const undoDelete = () => {
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
    if (pendingDelete) {
      upsertTask(pendingDelete);
      setPendingDelete(null);
      pendingDeleteId.current = null;
    }
  };

  // Komponent yopilганda yoki sahifa yangilanganda kutilayotgan o'chirishni yakunlaymiz —
  // aks holda 5 soniya tugamasidan chiqib ketilsa, o'chirish yo'qolib, vazifa qayta paydo bo'ladi.
  useEffect(() => {
    const flushNow = () => {
      if (deleteTimer.current) {
        clearTimeout(deleteTimer.current);
        deleteTimer.current = null;
      }
      if (pendingDeleteId.current) {
        // keepalive so'rovi sahifa yopilsa ham yetib boradi.
        api.deleteTask(pendingDeleteId.current).catch(() => {});
        pendingDeleteId.current = null;
      }
    };
    window.addEventListener("beforeunload", flushNow);
    return () => {
      window.removeEventListener("beforeunload", flushNow);
      flushNow(); // unmount (masalan logout / sahifa almashishi)
    };
  }, []);

  // Ctrl/Cmd+Z bilan oxirgi o'chirishni qaytarish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && pendingDelete) {
        e.preventDefault();
        undoDelete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  // --- Drag-and-drop: ko'rinayotgan ro'yxatni qayta tartiblash ---
  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const ids = visible.map((t) => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const newIds = [...ids];
    const [moved] = newIds.splice(from, 1);
    newIds.splice(to, 0, moved);
    // Faqat ko'rinayotgan vazifalarning mavjud position "slot"larini yangi tartibda
    // qayta taqsimlaymiz (backend bilan bir xil) — yashirin vazifalar bilan to'qnashmaydi.
    const slots = visible.map((t) => t.position).sort((a, b) => a - b);
    const posById = new Map<string, number>();
    newIds.forEach((id, i) => posById.set(id, slots[i]));
    setTasks((prev) =>
      prev.map((t) => (posById.has(t.id) ? { ...t, position: posById.get(t.id)! } : t))
    );
    setDragId(null);
    setDragOverId(null);
    api.reorderTasks(newIds).catch((e) => setError(String(e.message ?? e)));
  };

  const addProject = async (name: string) => {
    try {
      const p = await api.createProject({ name });
      setProjects((prev) => [...prev, p]);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const removeProject = async (id: string) => {
    try {
      await api.deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setTasks((prev) =>
        prev.map((t) => (t.project_id === id ? { ...t, project_id: null } : t))
      );
      if (selection.kind === "project" && selection.id === id)
        setSelection({ kind: "smart", view: "today" });
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  // --- Odat handlerlari ---
  const addHabit = async (data: Parameters<typeof api.createHabit>[0]) => {
    try {
      const h = await api.createHabit(data);
      setHabits((prev) => [...prev, h]);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const toggleHabit = async (id: string, day: string) => {
    // Optimistik yangilash
    setHabits((prev) =>
      prev.map((h) =>
        h.id === id
          ? {
              ...h,
              days: h.days.includes(day)
                ? h.days.filter((d) => d !== day)
                : [...h.days, day],
            }
          : h
      )
    );
    try {
      await api.toggleHabit(id, day);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const removeHabit = async (id: string) => {
    try {
      await api.deleteHabit(id);
      setHabits((prev) => prev.filter((h) => h.id !== id));
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  // --- Kichik qadamlar (subtasks) ---
  const addSubtask = async (taskId: string, title: string) => {
    try {
      const s = await api.createSubtask(taskId, title);
      setSubtasks((prev) => [...prev, s]);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };
  const toggleSubtask = async (id: string, done: boolean) => {
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, done } : s)));
    try {
      await api.updateSubtask(id, { done });
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };
  const renameSubtask = async (id: string, title: string) => {
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    try {
      await api.updateSubtask(id, { title });
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };
  const removeSubtask = async (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
    try {
      await api.deleteSubtask(id);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  // --- Eisenhower: kvadrantni o'rnatish ---
  const setQuadrant = (id: string, q: number) => patchTask(id, { eisenhower: q });

  // --- Kalendar: berilgan kunga vazifa qo'shish ---
  const addForDay = async (dayISO: string) => {
    const due = new Date(`${dayISO}T12:00:00`);
    try {
      const created = await api.createTask({
        title: t("main.newTask"),
        due_date: due.toISOString(),
      });
      upsertTask(created);
      setSelectedId(created.id);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const heading =
    selection.kind === "project"
      ? projects.find((p) => p.id === selection.id)?.name ?? t("main.project")
      : selection.kind === "smart" && selection.view === "today"
      ? t("main.today")
      : selection.kind === "smart" && selection.view === "upcoming"
      ? t("main.upcoming")
      : selection.kind === "smart" && selection.view === "completed"
      ? t("main.completed")
      : t("main.all");

  const completedView = selection.kind === "smart" && selection.view === "completed";

  const renderPage = () => {
    if (selection.kind !== "page") return null;
    // Sozlamalar yadro sahifa — doim ochiq. Qolganlari modul sifatida o'chirilishi mumkin.
    if (selection.page !== "settings" && !isEnabled(selection.page)) {
      return <div className="page empty-state">{t("features.disabled")}</div>;
    }
    switch (selection.page) {
      case "calendar":
        return <CalendarPage tasks={tasks} onSelectTask={setSelectedId} onAddForDay={addForDay} />;
      case "eisenhower":
        return <EisenhowerPage tasks={tasks} onSetQuadrant={setQuadrant} onSelectTask={setSelectedId} />;
      case "habits":
        return (
          <HabitsPage habits={habits} onCreate={addHabit} onToggle={toggleHabit} onDelete={removeHabit} />
        );
      case "pomodoro":
        return <PomodoroPage />;
      case "countdown":
        return <CountdownPage />;
      case "groups":
        return <GroupsPage user={user} />;
      case "stats":
        return <StatsPage userId={user.id} />;
      case "settings":
        return <SettingsPage user={user} onUserUpdate={onUserUpdate} onLogout={onLogout} />;
    }
  };

  return (
    <div className={`app ${navOpen ? "nav-open" : ""}`}>
      <CommandPalette
        tasks={tasks}
        habits={habits}
        projects={projects}
        onSelectTask={setSelectedId}
        onSelect={selectAndClear}
      />
      {/* Mobil: menyuni ochish tugmasi va fon (faqat kichik ekranda ko'rinadi) */}
      <button
        className="nav-toggle"
        onClick={() => setNavOpen((o) => !o)}
        aria-label={t("nav.menu")}
      >
        ☰
      </button>
      <div className="nav-backdrop" onClick={() => setNavOpen(false)} />
      <Sidebar
        projects={projects}
        counts={counts}
        selection={selection}
        user={user}
        onLogout={onLogout}
        onSelect={(s) => {
          setSelection(s);
          setSelectedId(null);
          setNavOpen(false); // tanlagach mobil drawer yopiladi
        }}
        onCreateProject={addProject}
        onDeleteProject={removeProject}
      />

      {selection.kind === "page" ? (
        renderPage()
      ) : (
      <main className="main">
        <header className="main-head">
          <h2>{heading}</h2>
          <input
            className="task-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("main.search")}
          />
          {!completedView && (
            <>
              <button
                className={`sort-toggle ${sortMode === "manual" ? "active" : ""}`}
                onClick={() => setSortMode((m) => (m === "smart" ? "manual" : "smart"))}
                title={t("main.sortTitle")}
              >
                {sortMode === "manual" ? t("main.sortManual") : t("main.sortSmart")}
              </button>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => setShowCompleted(e.target.checked)}
                />
                {t("main.showCompleted")}
              </label>
            </>
          )}
        </header>

        {error && (
          <div className="error-bar" onClick={() => setError(null)}>
            <Icon name="alert" size={15} /> {error} {t("main.errorClose")}
          </div>
        )}

        {tagFilter && (
          <div className="tag-filter-bar">
            <span>{t("main.filter")}</span>
            <span className="task-tag active">#{tagFilter}</span>
            <button className="tag-filter-clear" onClick={() => setTagFilter(null)}>
              {t("main.clearFilter")}
            </button>
          </div>
        )}

        {!completedView && (
          <form className="quick-add" onSubmit={addQuickTask}>
            <input
              ref={quickRef}
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              placeholder={t("main.quickAdd")}
            />
          </form>
        )}

        <div className="task-list">
          {visible.length === 0 ? (
            <div className="empty">{completedView ? t("main.completedEmpty") : t("main.empty")}</div>
          ) : (
            visible.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                selected={t.id === selectedId}
                onSelect={() => setSelectedId(t.id)}
                onComplete={() => (t.completed ? reopenTask(t.id) : completeTask(t.id))}
                onTagClick={(tag) => setTagFilter(tag)}
                subtaskCount={subtaskCounts[t.id]}
                draggable={sortMode === "manual"}
                dragging={dragId === t.id}
                dragOver={dragOverId === t.id && dragId !== t.id}
                onDragStart={() => setDragId(t.id)}
                onDragOver={() => setDragOverId(t.id)}
                onDrop={() => handleDrop(t.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDragOverId(null);
                }}
              />
            ))
          )}
        </div>
      </main>
      )}

      {pendingDelete && (
        <div className="undo-toast">
          <span><Icon name="trash" size={14} /> "{pendingDelete.title}" {t("main.undoDeleted")}</span>
          <button onClick={undoDelete}>{t("main.undo")}</button>
        </div>
      )}

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          projects={projects}
          subtasks={selectedSubtasks}
          onChange={(patch) => patchTask(selectedTask.id, patch)}
          onDelete={() => removeTask(selectedTask.id)}
          onClose={() => setSelectedId(null)}
          onAddSubtask={(title) => addSubtask(selectedTask.id, title)}
          onToggleSubtask={toggleSubtask}
          onRenameSubtask={renameSubtask}
          onDeleteSubtask={removeSubtask}
        />
      )}
    </div>
  );
}
