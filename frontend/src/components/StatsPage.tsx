import { useEffect, useMemo, useState } from "react";
import { api, type PomodoroStats } from "../api";
import type { GroupDetail, Habit, Project, Subtask, Task } from "../types";
import { PRIORITY_COLORS } from "../types";
import { StatTile, LineChart, HBarChart, Donut, ColumnChart } from "./charts";
import { Icon } from "./Icon";
import { useT, priorityLabel, weekdayShorts, getLang } from "../i18n";

const S1 = "var(--viz-s1)"; // ko'k
const S2 = "var(--viz-s2)"; // aqua
const MUTED = "var(--viz-remaining)";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentStreak(days: Set<string>): number {
  let s = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (!days.has(ymd(d))) d.setTime(d.getTime() - 86400000);
  while (days.has(ymd(d))) {
    s++;
    d.setTime(d.getTime() - 86400000);
  }
  return s;
}

interface Data {
  tasks: Task[];
  habits: Habit[];
  subtasks: Subtask[];
  projects: Project[];
  groups: GroupDetail[];
  pomodoro: PomodoroStats;
}

const POMO = "#ef4444"; // pomodoro (qizil)

export function StatsPage({ userId }: { userId: string }) {
  const t = useT();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [tasks, habits, subtasks, projects, groupList, pomodoro] = await Promise.all([
          api.listTasks({}),
          api.listHabits(),
          api.listSubtasks(),
          api.listProjects(),
          api.listGroups(),
          api.pomodoroStats(),
        ]);
        const groups = await Promise.all(groupList.map((g) => api.getGroup(g.id)));
        setData({ tasks, habits, subtasks, projects, groups, pomodoro });
      } catch (e: any) {
        setError(String(e.message ?? e));
      }
    })();
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const { tasks, habits, subtasks, projects, groups, pomodoro } = data;

    // ----- KPI -----
    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.completed).length;
    const groupTasksDone = groups.reduce(
      (s, g) => s + g.tasks.filter((t) => t.done && t.done_by === userId).length,
      0
    );
    const completionRate = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

    let groupCheckins = 0;
    for (const g of groups)
      for (const h of g.habits) groupCheckins += (h.entries[userId] ?? []).length;
    const habitCheckins = habits.reduce((s, h) => s + h.days.length, 0) + groupCheckins;

    const bestStreak = Math.max(0, ...habits.map((h) => currentStreak(new Set(h.days))));
    const subDone = subtasks.filter((s) => s.done).length;

    // ----- 30 kunlik chiziq -----
    const days: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) days.push(ymd(new Date(today.getTime() - i * 86400000)));
    const dayIndex = new Map(days.map((d, i) => [d, i]));

    const taskDone30 = new Array(30).fill(0);
    for (const t of tasks) {
      if (t.completed && t.completed_at) {
        const key = ymd(new Date(t.completed_at));
        const i = dayIndex.get(key);
        if (i !== undefined) taskDone30[i]++;
      }
    }
    const habit30 = new Array(30).fill(0);
    for (const h of habits)
      for (const d of h.days) {
        const i = dayIndex.get(d);
        if (i !== undefined) habit30[i]++;
      }
    for (const g of groups)
      for (const h of g.habits)
        for (const d of h.entries[userId] ?? []) {
          const i = dayIndex.get(d);
          if (i !== undefined) habit30[i]++;
        }
    // Pomodoro — oxirgi 30 kun (kunlar oynasiga moslashtiriladi)
    const pomo30 = new Array(30).fill(0);
    for (const row of pomodoro.last30) {
      const i = dayIndex.get(row.day);
      if (i !== undefined) pomo30[i] = row.count;
    }

    const lineLabels = days.map((d) => d.slice(8)); // kun raqami

    // ----- Prioritet donut -----
    const byPrio = [0, 1, 2, 3].map((p) => ({
      label: priorityLabel(p),
      value: tasks.filter((task) => task.priority === p).length,
      color: PRIORITY_COLORS[p],
    }));

    // ----- Loyihalar (bajarilgan/qolgan) -----
    const projRows = projects
      .map((p) => {
        const pts = tasks.filter((t) => t.project_id === p.id);
        const done = pts.filter((t) => t.completed).length;
        const rest = pts.length - done;
        return {
          label: p.name,
          color: p.color,
          value: pts.length,
          segments: [
            { value: done, color: p.color, name: t("stats.done") },
            { value: rest, color: MUTED, name: t("stats.remaining") },
          ],
        };
      })
      .filter((r) => r.value > 0);
    const noProj = tasks.filter((task) => !task.project_id);
    if (noProj.length) {
      const done = noProj.filter((task) => task.completed).length;
      projRows.push({
        label: t("stats.noProject"),
        color: MUTED,
        value: noProj.length,
        segments: [
          { value: done, color: S1, name: t("stats.done") },
          { value: noProj.length - done, color: MUTED, name: t("stats.remaining") },
        ],
      });
    }
    projRows.sort((a, b) => b.value - a.value);

    // ----- Teglar top -----
    const tagCount = new Map<string, number>();
    for (const t of tasks) for (const tag of t.tags ?? []) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    const tagRows = [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ label: `#${tag}`, color: S1, value: count }));

    // ----- Hafta kunlari bo'yicha faollik -----
    const wdNames = weekdayShorts();
    const wd = new Array(7).fill(0);
    const addWd = (iso: string) => {
      const dt = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
      wd[(dt.getDay() + 6) % 7]++;
    };
    for (const t of tasks) if (t.completed && t.completed_at) addWd(t.completed_at);
    for (const h of habits) for (const d of h.days) addWd(d);
    for (const g of groups) for (const h of g.habits) for (const d of h.entries[userId] ?? []) addWd(d);
    const weekdayData = wdNames.map((label, i) => ({ label, value: wd[i] }));

    // ----- Odatlar shu hafta -----
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const weekDays = Array.from({ length: 7 }, (_, i) => ymd(new Date(monday.getTime() + i * 86400000)));
    const habitRows = habits
      .map((h) => {
        const set = new Set(h.days);
        const cnt = weekDays.filter((d) => set.has(d)).length;
        return { label: h.name, color: h.color, value: cnt };
      })
      .sort((a, b) => b.value - a.value);

    return {
      kpi: {
        totalTasks, doneTasks, groupTasksDone, completionRate, habitCheckins, bestStreak,
        subDone, subTotal: subtasks.length,
        pomoToday: pomodoro.today, pomoTotal: pomodoro.total, pomoMinutes: pomodoro.minutes_total,
      },
      line: { labels: lineLabels, series: [
        { name: t("stats.seriesTasks"), color: S1, points: taskDone30 },
        { name: t("stats.seriesHabits"), color: S2, points: habit30 },
        { name: t("stats.seriesPomodoro"), color: POMO, points: pomo30 },
      ] },
      byPrio,
      projRows,
      tagRows,
      weekdayData,
      habitRows,
      hasGroups: groups.length > 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, userId, getLang()]);

  if (error) return <div className="page stats-page"><div className="error-bar"><Icon name="alert" size={15} /> {error}</div></div>;
  if (!stats) return <div className="page stats-page"><div className="page-head"><h2>{t("stats.title")}</h2></div><div className="empty">{t("app.loading")}</div></div>;

  return (
    <div className="page stats-page">
      <div className="page-head">
        <h2>{t("stats.title")}</h2>
        <span className="page-hint">{t("stats.hint")}</span>
      </div>

      {/* KPI tiles */}
      <div className="stat-cards">
        <StatTile value={stats.kpi.completionRate} unit="%" label={t("stats.completionRate")} icon="target" accent={S1} />
        <StatTile value={stats.kpi.doneTasks} label={t("stats.doneTasks")} icon="circle-check" />
        <StatTile value={stats.kpi.totalTasks} label={t("stats.totalTasks")} icon="clipboard" />
        <StatTile value={stats.kpi.habitCheckins} label={t("stats.habitCheckins")} icon="flame" />
        <StatTile value={stats.kpi.bestStreak} label={t("stats.bestStreak")} icon="award" />
        <StatTile value={`${stats.kpi.subDone}/${stats.kpi.subTotal}`} label={t("stats.subtasks")} icon="list-checks" />
        <StatTile value={stats.kpi.pomoToday} label={t("stats.pomoToday")} icon="timer" />
        <StatTile value={Math.round(stats.kpi.pomoMinutes / 60)} unit={t("stats.hoursUnit")} label={t("stats.focusTime")} icon="clock" />
        {stats.hasGroups && (
          <StatTile value={stats.kpi.groupTasksDone} label={t("stats.groupDone")} icon="users" />
        )}
      </div>

      <div className="chart-grid">
        {/* 30 kunlik faollik */}
        <div className="chart-card wide">
          <h3>{t("stats.chart30")}</h3>
          <LineChart series={stats.line.series} labels={stats.line.labels} />
        </div>

        {/* Prioritet */}
        <div className="chart-card">
          <h3>{t("stats.byPriority")}</h3>
          <Donut
            data={stats.byPrio}
            centerLabel={t("stats.total")}
            centerValue={stats.kpi.totalTasks}
          />
        </div>

        {/* Hafta kunlari */}
        <div className="chart-card">
          <h3>{t("stats.weekdayActivity")}</h3>
          <ColumnChart data={stats.weekdayData} color={S1} />
        </div>

        {/* Loyihalar */}
        <div className="chart-card">
          <h3>{t("stats.byProject")}</h3>
          <HBarChart rows={stats.projRows} />
          <div className="chart-legend">
            <span className="legend-item"><span className="legend-swatch" style={{ background: S1 }} />{t("stats.done")}</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: MUTED }} />{t("stats.remaining")}</span>
          </div>
        </div>

        {/* Odatlar shu hafta */}
        <div className="chart-card">
          <h3>{t("stats.habitsThisWeek")}</h3>
          <HBarChart rows={stats.habitRows} />
        </div>

        {/* Teglar */}
        {stats.tagRows.length > 0 && (
          <div className="chart-card">
            <h3>{t("stats.topTags")}</h3>
            <HBarChart rows={stats.tagRows} />
          </div>
        )}
      </div>
    </div>
  );
}
