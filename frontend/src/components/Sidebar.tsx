import { useState } from "react";
import type { Project, User } from "../types";
import { useT } from "../i18n";
import { useFeatures } from "../features";

export type Page = "calendar" | "eisenhower" | "habits" | "groups" | "stats" | "pomodoro" | "countdown" | "settings";

export type Selection =
  | { kind: "smart"; view: "today" | "upcoming" | "all" | "completed" }
  | { kind: "project"; id: string }
  | { kind: "page"; page: Page };

const PAGES: { page: Page; key: string; icon: string }[] = [
  { page: "calendar", key: "nav.calendar", icon: "📆" },
  { page: "eisenhower", key: "nav.eisenhower", icon: "🧭" },
  { page: "habits", key: "nav.habits", icon: "🔥" },
  { page: "groups", key: "nav.groups", icon: "👥" },
  { page: "stats", key: "nav.stats", icon: "📈" },
  { page: "pomodoro", key: "nav.pomodoro", icon: "🍅" },
  { page: "countdown", key: "nav.countdown", icon: "⏳" },
];

interface Props {
  projects: Project[];
  counts: { today: number; upcoming: number; all: number; completed: number; byProject: Record<string, number> };
  selection: Selection;
  user: User;
  onLogout: () => void;
  onSelect: (s: Selection) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (id: string) => void;
}

const SMART = [
  { view: "today", key: "nav.today", icon: "📅" },
  { view: "upcoming", key: "nav.upcoming", icon: "🗓️" },
  { view: "all", key: "nav.all", icon: "📥" },
  { view: "completed", key: "nav.completed", icon: "✅" },
] as const;

export function Sidebar({
  projects,
  counts,
  selection,
  user,
  onLogout,
  onSelect,
  onCreateProject,
  onDeleteProject,
}: Props) {
  const [newName, setNewName] = useState("");
  const t = useT();
  const { isEnabled } = useFeatures();
  // Faqat yoqilgan modullar menyuda ko'rinadi (kalit = sahifa nomi).
  const pages = PAGES.filter((p) => isEnabled(p.page));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = newName.trim();
    if (n) {
      onCreateProject(n);
      setNewName("");
    }
  };

  return (
    <aside className="sidebar">
      <h1 className="logo">✓ Challanger</h1>

      <nav className="nav-group">
        {SMART.map((s) => {
          const active = selection.kind === "smart" && selection.view === s.view;
          return (
            <button
              key={s.view}
              className={`nav-item ${active ? "active" : ""}`}
              onClick={() => onSelect({ kind: "smart", view: s.view })}
            >
              <span className="nav-icon">{s.icon}</span>
              <span className="nav-label">{t(s.key)}</span>
              <span className="nav-count">{counts[s.view]}</span>
            </button>
          );
        })}
      </nav>

      <div className="nav-heading">{t("nav.tools")}</div>
      <nav className="nav-group">
        {pages.map((p) => {
          const active = selection.kind === "page" && selection.page === p.page;
          return (
            <button
              key={p.page}
              className={`nav-item ${active ? "active" : ""}`}
              onClick={() => onSelect({ kind: "page", page: p.page })}
            >
              <span className="nav-icon">{p.icon}</span>
              <span className="nav-label">{t(p.key)}</span>
            </button>
          );
        })}
      </nav>

      <div className="nav-heading">{t("nav.projects")}</div>
      <nav className="nav-group">
        {projects.map((p) => {
          const active = selection.kind === "project" && selection.id === p.id;
          return (
            <div key={p.id} className={`nav-item project ${active ? "active" : ""}`}>
              <button className="project-main" onClick={() => onSelect({ kind: "project", id: p.id })}>
                <span className="dot" style={{ background: p.color }} />
                <span className="nav-label">{p.name}</span>
                <span className="nav-count">{counts.byProject[p.id] ?? 0}</span>
              </button>
              <button
                className="project-del"
                title={t("nav.delete")}
                onClick={() => onDeleteProject(p.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </nav>

      <form className="add-project" onSubmit={submit}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("nav.newProject")}
        />
      </form>

      <div className="sidebar-footer">
        <button
          className={`user-info ${selection.kind === "page" && selection.page === "settings" ? "active" : ""}`}
          onClick={() => onSelect({ kind: "page", page: "settings" })}
          title={t("nav.settings")}
        >
          <span className="avatar">{user.username.charAt(0).toUpperCase()}</span>
          <span className="username">{user.username}</span>
          <span className="gear">⚙️</span>
        </button>
        <button className="logout" onClick={onLogout} title={t("nav.logout")}>
          ⎋
        </button>
      </div>
    </aside>
  );
}
