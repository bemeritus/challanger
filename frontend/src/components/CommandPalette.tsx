import { useEffect, useMemo, useRef, useState } from "react";
import type { Habit, Project, Task } from "../types";
import type { Page, Selection } from "./Sidebar";
import { useT, getLang } from "../i18n";
import { Icon, type IconName } from "./Icon";

interface Item {
  kind: "task" | "habit" | "project" | "page";
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  action: () => void;
}

interface Props {
  tasks: Task[];
  habits: Habit[];
  projects: Project[];
  onSelectTask: (id: string) => void;
  onSelect: (s: Selection) => void;
}

const PAGE_ITEMS: { page: Page; labelKey: string; icon: IconName }[] = [
  { page: "calendar", labelKey: "nav.calendar", icon: "calendar-days" },
  { page: "eisenhower", labelKey: "nav.eisenhower", icon: "grid" },
  { page: "habits", labelKey: "nav.habits", icon: "repeat" },
  { page: "groups", labelKey: "nav.groups", icon: "users" },
  { page: "stats", labelKey: "nav.stats", icon: "bar-chart" },
  { page: "pomodoro", labelKey: "nav.pomodoro", icon: "timer" },
  { page: "countdown", labelKey: "nav.countdown", icon: "hourglass" },
  { page: "settings", labelKey: "nav.settings", icon: "sliders" },
];

export function CommandPalette({ tasks, habits, projects, onSelectTask, onSelect }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+K bilan ochish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const close = () => setOpen(false);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [];
    for (const p of PAGE_ITEMS) {
      all.push({
        kind: "page",
        id: p.page,
        label: t(p.labelKey),
        hint: t("cmdk.page"),
        icon: p.icon,
        action: () => onSelect({ kind: "page", page: p.page }),
      });
    }
    for (const p of projects) {
      all.push({
        kind: "project",
        id: p.id,
        label: p.name,
        hint: t("cmdk.project"),
        icon: "folder",
        action: () => onSelect({ kind: "project", id: p.id }),
      });
    }
    for (const task of tasks) {
      all.push({
        kind: "task",
        id: task.id,
        label: task.title,
        hint: task.completed ? t("cmdk.taskDone") : t("cmdk.task"),
        icon: task.completed ? "circle-check" : "circle",
        action: () => onSelectTask(task.id),
      });
    }
    for (const h of habits) {
      all.push({
        kind: "habit",
        id: h.id,
        label: h.name,
        hint: t("cmdk.habit"),
        icon: "repeat",
        action: () => onSelect({ kind: "page", page: "habits" }),
      });
    }
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, habits, projects, onSelect, onSelectTask, getLang()]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items.slice(0, 8);
    return items.filter((i) => i.label.toLowerCase().includes(term)).slice(0, 12);
  }, [items, q]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered, active]);

  if (!open) return null;

  const run = (i: Item) => {
    i.action();
    close();
  };

  return (
    <div className="cmdk-overlay" onClick={close}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("cmdk.placeholder")}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && filtered[active]) {
              e.preventDefault();
              run(filtered[active]);
            }
          }}
        />
        <div className="cmdk-list">
          {filtered.length === 0 && <div className="cmdk-empty">{t("cmdk.empty")}</div>}
          {filtered.map((i, idx) => (
            <button
              key={`${i.kind}:${i.id}`}
              className={`cmdk-item ${idx === active ? "active" : ""}`}
              onMouseEnter={() => setActive(idx)}
              onClick={() => run(i)}
            >
              <span className="cmdk-icon"><Icon name={i.icon} /></span>
              <span className="cmdk-label">{i.label}</span>
              <span className="cmdk-hint">{i.hint}</span>
            </button>
          ))}
        </div>
        <div className="cmdk-foot">
          <span>{t("cmdk.select")}</span>
          <span>{t("cmdk.open")}</span>
          <span>{t("cmdk.close")}</span>
        </div>
      </div>
    </div>
  );
}
