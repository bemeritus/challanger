import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { User } from "../types";
import { getTheme, setTheme, type Theme } from "../theme";
import { getLang, setLang, useT, LANG_LABELS, type Lang } from "../i18n";
import { pushState as getPushState, enablePush, disablePush } from "../push";
import { useFeatures } from "../features";
import { Icon } from "./Icon";

interface Props {
  user: User;
  onUserUpdate: (u: User) => void;
  onLogout: () => void;
}

type Msg = { kind: "ok" | "err"; text: string } | null;

export function SettingsPage({ user, onUserUpdate, onLogout }: Props) {
  const t = useT();
  const [lang, setLangState] = useState<Lang>(getLang());
  const chooseLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  // --- Modullar (features) ---
  const { features, isAdmin, setMine, setGlobal } = useFeatures();
  const [featBusy, setFeatBusy] = useState<string | null>(null);
  const toggleMine = async (key: string, enabled: boolean) => {
    setFeatBusy(key);
    try {
      await setMine(key, enabled);
    } finally {
      setFeatBusy(null);
    }
  };
  const toggleGlobal = async (key: string, enabled: boolean) => {
    setFeatBusy(key);
    try {
      await setGlobal(key, enabled);
    } finally {
      setFeatBusy(null);
    }
  };

  // --- Profil ---
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // --- Parol ---
  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passMsg, setPassMsg] = useState<Msg>(null);
  const [savingPass, setSavingPass] = useState(false);

  // --- Mavzu ---
  const [theme, setThemeState] = useState<Theme>(getTheme());

  // --- Bildirishnoma ---
  const [notif, setNotif] = useState<NotificationPermission | "unsupported">(
    "Notification" in window ? Notification.permission : "unsupported"
  );

  // --- Web Push ---
  const [push, setPush] = useState<Awaited<ReturnType<typeof getPushState>> | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);
  useEffect(() => {
    getPushState().then(setPush).catch(() => setPush("unsupported"));
  }, []);
  const togglePush = async () => {
    setPushBusy(true);
    setPushErr(null);
    try {
      if (push === "subscribed") {
        await disablePush();
        setPush("unsubscribed");
      } else {
        await enablePush();
        setPush("subscribed");
        setNotif(Notification.permission);
      }
    } catch (e: any) {
      setPushErr(String(e.message ?? e));
    } finally {
      setPushBusy(false);
    }
  };

  // --- Telegram ---
  const [tg, setTg] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [tgLink, setTgLink] = useState<string | null>(null);
  const [tgBusy, setTgBusy] = useState(false);

  useEffect(() => {
    api.telegramStatus().then(setTg).catch(() => setTg(null));
  }, []);

  const connectTelegram = async () => {
    setTgBusy(true);
    try {
      const res = await api.telegramLink();
      setTgLink(res.deep_link);
      window.open(res.deep_link, "_blank");
      // Bir necha soniyadan so'ng holatni qayta tekshiramiz (bot ulagan bo'lsa)
      setTimeout(() => api.telegramStatus().then(setTg).catch(() => {}), 4000);
    } catch {
      /* xato — jim o'tamiz */
    } finally {
      setTgBusy(false);
    }
  };

  const refreshTelegram = () => api.telegramStatus().then(setTg).catch(() => {});

  const disconnectTelegram = async () => {
    setTgBusy(true);
    try {
      await api.telegramUnlink();
      setTgLink(null);
      setTg((s) => (s ? { ...s, connected: false } : s));
    } finally {
      setTgBusy(false);
    }
  };

  // --- Kalendar feed (iCal obuna) ---
  const [calUrl, setCalUrl] = useState<string | null>(null);
  const [calBusy, setCalBusy] = useState(false);
  const [calCopied, setCalCopied] = useState(false);
  const fullCalUrl = (path: string) => `${window.location.origin}${path}`;

  const enableCalendar = async () => {
    setCalBusy(true);
    try {
      const res = await api.calendarEnable();
      setCalUrl(res.path ? fullCalUrl(res.path) : null);
    } finally {
      setCalBusy(false);
    }
  };
  const regenCalendar = async () => {
    setCalBusy(true);
    try {
      const res = await api.calendarRegenerate();
      setCalUrl(res.path ? fullCalUrl(res.path) : null);
      setCalCopied(false);
    } finally {
      setCalBusy(false);
    }
  };
  const copyCalUrl = async () => {
    if (!calUrl) return;
    try {
      await navigator.clipboard.writeText(calUrl);
      setCalCopied(true);
      setTimeout(() => setCalCopied(false), 2000);
    } catch {
      /* clipboard yo'q — jim o'tamiz */
    }
  };

  // --- Ma'lumot eksport/import ---
  const [dataMsg, setDataMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- Hisobni o'chirish ---
  const [confirmDelete, setConfirmDelete] = useState(false);

  const exportData = async () => {
    setDataMsg(null);
    setBusy(true);
    try {
      const [projects, tasks, habits, subtasks] = await Promise.all([
        api.listProjects(),
        api.listTasks({}),
        api.listHabits(),
        api.listSubtasks(),
      ]);
      const dump = { version: 1, exported_at: new Date().toISOString(), projects, tasks, habits, subtasks };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `challanger-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDataMsg({ kind: "ok", text: t("settings.dataDownloaded") });
    } catch (err: any) {
      setDataMsg({ kind: "err", text: String(err.message ?? err) });
    } finally {
      setBusy(false);
    }
  };

  const importData = async (file: File) => {
    setDataMsg(null);
    setBusy(true);
    try {
      const dump = JSON.parse(await file.text());
      // Loyihalar — eski id -> yangi id
      const projMap = new Map<string, string>();
      for (const p of dump.projects ?? []) {
        const created = await api.createProject({ name: p.name, color: p.color });
        projMap.set(p.id, created.id);
      }
      // Vazifalar — eski id -> yangi id
      const taskMap = new Map<string, string>();
      for (const t of dump.tasks ?? []) {
        const created = await api.createTask({
          title: t.title,
          notes: t.notes ?? "",
          due_date: t.due_date ?? null,
          priority: t.priority ?? 0,
          recurrence: t.recurrence ?? null,
          reminder_at: t.reminder_at ?? null,
          project_id: t.project_id ? projMap.get(t.project_id) ?? null : null,
          tags: t.tags ?? [],
        } as any);
        taskMap.set(t.id, created.id);
        if (t.completed || t.eisenhower != null) {
          await api.updateTask(created.id, {
            ...(t.completed ? { completed: true } : {}),
            ...(t.eisenhower != null ? { eisenhower: t.eisenhower } : {}),
          });
        }
      }
      // Kichik qadamlar
      for (const s of dump.subtasks ?? []) {
        const newTaskId = taskMap.get(s.task_id);
        if (!newTaskId) continue;
        const created = await api.createSubtask(newTaskId, s.title);
        if (s.done) await api.updateSubtask(created.id, { done: true });
      }
      // Odatlar
      for (const h of dump.habits ?? []) {
        await api.createHabit({
          name: h.name,
          color: h.color,
          frequency: h.frequency,
          target_per_week: h.target_per_week,
          duration_days: h.duration_days ?? undefined,
          end_date: h.end_date ?? undefined,
        });
      }
      setDataMsg({ kind: "ok", text: t("settings.importDone") });
    } catch (err: any) {
      setDataMsg({ kind: "err", text: t("settings.importError", { msg: String(err.message ?? err) }) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const profileChanged = username !== user.username || email !== user.email;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const updated = await api.updateProfile({ username, email });
      onUserUpdate(updated);
      setUsername(updated.username);
      setEmail(updated.email);
      setProfileMsg({ kind: "ok", text: t("settings.profileSaved") });
    } catch (err: any) {
      setProfileMsg({ kind: "err", text: String(err.message ?? err) });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMsg(null);
    if (newPass !== confirmPass) {
      setPassMsg({ kind: "err", text: t("settings.passwordMismatch") });
      return;
    }
    setSavingPass(true);
    try {
      await api.changePassword({ current_password: curPass, new_password: newPass });
      setCurPass("");
      setNewPass("");
      setConfirmPass("");
      setPassMsg({ kind: "ok", text: t("settings.passwordChanged") });
    } catch (err: any) {
      setPassMsg({ kind: "err", text: String(err.message ?? err) });
    } finally {
      setSavingPass(false);
    }
  };

  const chooseTheme = (th: Theme) => {
    setTheme(th);
    setThemeState(th);
  };

  const requestNotif = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setNotif(p);
  };

  const deleteAccount = async () => {
    try {
      await api.deleteAccount();
      onLogout();
    } catch {
      /* onLogout baribir chaqiriladi */
      onLogout();
    }
  };

  return (
    <div className="page settings-page">
      <div className="page-head">
        <h2>{t("settings.title")}</h2>
      </div>

      {/* Profil */}
      <section className="card">
        <h3>{t("settings.profile")}</h3>
        <form onSubmit={saveProfile} className="settings-form">
          <label className="settings-field">
            <span>{t("auth.username")}</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
              minLength={3}
              maxLength={20}
              required
            />
            <small>{t("settings.usernameHint")}</small>
          </label>
          <label className="settings-field">
            <span>{t("auth.email")}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {profileMsg && <div className={`settings-msg ${profileMsg.kind}`}>{profileMsg.text}</div>}
          <button type="submit" className="btn-primary" disabled={!profileChanged || savingProfile}>
            {savingProfile ? "…" : t("common.save")}
          </button>
        </form>
      </section>

      {/* Parol */}
      <section className="card">
        <h3>{t("settings.changePassword")}</h3>
        <form onSubmit={savePassword} className="settings-form">
          <label className="settings-field">
            <span>{t("settings.curPassword")}</span>
            <input type="password" value={curPass} onChange={(e) => setCurPass(e.target.value)} required />
          </label>
          <label className="settings-field">
            <span>{t("settings.newPassword")}</span>
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              minLength={6}
              required
            />
          </label>
          <label className="settings-field">
            <span>{t("settings.confirmPassword")}</span>
            <input
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              minLength={6}
              required
            />
          </label>
          {passMsg && <div className={`settings-msg ${passMsg.kind}`}>{passMsg.text}</div>}
          <button type="submit" className="btn-primary" disabled={savingPass}>
            {savingPass ? "…" : t("settings.updatePassword")}
          </button>
        </form>
      </section>

      {/* Til */}
      <section className="card">
        <h3>{t("settings.language")}</h3>
        <div className="seg">
          {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              className={lang === l ? "active" : ""}
              onClick={() => chooseLang(l)}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </section>

      {/* Ko'rinish */}
      <section className="card">
        <h3>{t("settings.appearance")}</h3>
        <div className="seg">
          {(["system", "light", "dark", "gruvbox"] as Theme[]).map((th) => (
            <button
              key={th}
              type="button"
              className={theme === th ? "active" : ""}
              onClick={() => chooseTheme(th)}
            >
              {th === "system"
                ? t("settings.themeSystem")
                : th === "light"
                ? t("settings.themeLight")
                : th === "dark"
                ? t("settings.themeDark")
                : t("settings.themeGruvbox")}
            </button>
          ))}
        </div>
      </section>

      {/* Modullar */}
      <section className="card">
        <h3>{t("settings.features")}</h3>
        <p className="settings-note">
          {isAdmin ? t("settings.featuresInfoAdmin") : t("settings.featuresInfo")}
        </p>
        <div className="feature-list">
          {features.map((f) => {
            const globalOff = !f.global_enabled;
            return (
              <div key={f.key} className="settings-inline feature-row">
                <span className="settings-note">
                  {t("nav." + f.key)}
                  {globalOff && <em> · {t("settings.featureGlobalOff")}</em>}
                </span>
                <div className="confirm-row">
                  {isAdmin && (
                    <button
                      className={f.global_enabled ? "btn-secondary" : "btn-primary"}
                      disabled={featBusy === f.key}
                      onClick={() => toggleGlobal(f.key, !f.global_enabled)}
                    >
                      {t("settings.featureGlobal")}:{" "}
                      {f.global_enabled ? t("common.on") : t("common.off")}
                    </button>
                  )}
                  <button
                    className={f.user_enabled ? "btn-secondary" : "btn-primary"}
                    disabled={globalOff || featBusy === f.key}
                    onClick={() => toggleMine(f.key, !f.user_enabled)}
                  >
                    {f.user_enabled ? t("settings.featureHide") : t("settings.featureShow")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Bildirishnoma */}
      <section className="card">
        <h3>{t("settings.notifications")}</h3>
        {notif === "unsupported" ? (
          <p className="settings-note">{t("settings.notifUnsupported")}</p>
        ) : notif === "granted" ? (
          <p className="settings-note">{t("settings.notifGranted")}</p>
        ) : (
          <div className="settings-inline">
            <p className="settings-note">
              {notif === "denied"
                ? t("settings.notifDenied")
                : t("settings.notifDefault")}
            </p>
            <button className="btn-secondary" onClick={requestNotif} disabled={notif === "denied"}>
              {t("settings.allow")}
            </button>
          </div>
        )}

        {/* Web Push — ilova yopiq bo'lsa ham keladigan bildirishnoma */}
        {push && push !== "unsupported" && push !== "disabled" && (
          <div className="settings-inline push-row">
            <p className="settings-note">
              {push === "subscribed" ? t("settings.pushOn") : t("settings.pushOff")}
            </p>
            <button
              className={push === "subscribed" ? "btn-secondary" : "btn-primary"}
              onClick={togglePush}
              disabled={pushBusy || push === "denied"}
            >
              {pushBusy ? "…" : push === "subscribed" ? t("settings.pushDisable") : t("settings.pushEnable")}
            </button>
          </div>
        )}
        {pushErr && <p className="settings-note err"><Icon name="alert" size={14} /> {pushErr}</p>}
      </section>

      {/* Telegram */}
      <section className="card">
        <h3>{t("settings.telegram")}</h3>
        {tg === null ? (
          <p className="settings-note">{t("app.loading")}</p>
        ) : !tg.configured ? (
          <p className="settings-note">
            {t("settings.tgNotConfiguredPre")} <code>TELEGRAM_BOT_TOKEN</code> {t("settings.tgNotConfiguredPost")}
          </p>
        ) : tg.connected ? (
          <div className="settings-inline">
            <p className="settings-note">{t("settings.tgConnected")}</p>
            <button className="btn-secondary" onClick={disconnectTelegram} disabled={tgBusy}>
              {t("settings.disconnect")}
            </button>
          </div>
        ) : (
          <div className="settings-form">
            <p className="settings-note">{t("settings.tgConnectInfo")}</p>
            <div className="settings-inline">
              <span className="settings-note">{t("settings.tgStartHint")}</span>
              <div className="confirm-row">
                <button className="btn-primary" onClick={connectTelegram} disabled={tgBusy}>
                  {tgBusy ? "…" : t("settings.tgConnect")}
                </button>
                <button className="btn-secondary" onClick={refreshTelegram} disabled={tgBusy}>
                  {t("settings.tgCheck")}
                </button>
              </div>
            </div>
            {tgLink && (
              <small className="settings-note">
                {t("settings.tgLinkFailPre")}{" "}
                <a href={tgLink} target="_blank" rel="noreferrer">
                  {tgLink}
                </a>{" "}
                <br />
                {t("settings.tgLinkFailPost")}
              </small>
            )}
          </div>
        )}
      </section>

      {/* Kalendar obunasi */}
      <section className="card">
        <h3>{t("settings.calTitle")}</h3>
        <p className="settings-note">{t("settings.calInfo")}</p>
        {!calUrl ? (
          <button className="btn-primary" onClick={enableCalendar} disabled={calBusy}>
            {calBusy ? "…" : t("settings.calCreate")}
          </button>
        ) : (
          <div className="settings-form">
            <div className="settings-inline">
              <input className="cal-url" readOnly value={calUrl} onFocus={(e) => e.target.select()} />
              <button className="btn-secondary" onClick={copyCalUrl}>
                {calCopied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            <small className="settings-note">{t("settings.calSubHint")}</small>
            <button className="btn-secondary" onClick={regenCalendar} disabled={calBusy}>
              {t("settings.calRegen")}
            </button>
          </div>
        )}
      </section>

      {/* Ma'lumotlar */}
      <section className="card">
        <h3>{t("settings.dataTitle")}</h3>
        {dataMsg && <div className={`settings-msg ${dataMsg.kind}`}>{dataMsg.text}</div>}
        <div className="settings-inline">
          <span className="settings-note">{t("settings.dataInfo")}</span>
          <div className="confirm-row">
            <button className="btn-secondary" onClick={exportData} disabled={busy}>
              {t("settings.export")}
            </button>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
              {t("settings.import")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importData(f);
              }}
            />
          </div>
        </div>
        {busy && <p className="settings-note">{t("settings.working")}</p>}
      </section>

      {/* Hisob */}
      <section className="card danger-zone">
        <h3>{t("settings.account")}</h3>
        <div className="settings-inline">
          <span className="settings-note">{t("settings.logoutLabel")}</span>
          <button className="btn-secondary" onClick={onLogout}>{t("settings.logoutBtn")}</button>
        </div>
        <hr />
        <div className="settings-inline">
          <span className="settings-note">{t("settings.deleteAccountInfo")}</span>
          {!confirmDelete ? (
            <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
              {t("settings.deleteAccount")}
            </button>
          ) : (
            <div className="confirm-row">
              <button className="btn-danger" onClick={deleteAccount}>{t("settings.confirmDelete")}</button>
              <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
