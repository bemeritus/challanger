import { useState } from "react";
import { api, tokenStore } from "../api";
import type { User } from "../types";
import { useT } from "../i18n";
import { Icon } from "./Icon";

interface Props {
  onAuth: (user: User) => void;
}

type Mode = "login" | "signup";

export function AuthScreen({ onAuth }: Props) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await api.signup({ username, email, password })
          : await api.login({ email, password });
      tokenStore.setTokens(res.token, res.refresh_token);
      onAuth(res.user);
    } catch (err: any) {
      setError(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-logo">✓ Challanger</h1>
        <p className="auth-sub">
          {mode === "login" ? t("auth.loginSub") : t("auth.signupSub")}
        </p>

        {mode === "signup" && (
          <label className="auth-field">
            <span>{t("auth.username")}</span>
            <input
              value={username}
              onChange={(e) =>
                // Faqat kichik harflar va raqamlar (bo'sh joy va boshqa belgilar olib tashlanadi)
                setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))
              }
              placeholder="rustacean"
              minLength={3}
              maxLength={20}
              required
              autoFocus
            />
            <small className="auth-hint">{t("auth.usernameHint")}</small>
          </label>
        )}

        <label className="auth-field">
          <span>{t("auth.email")}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            required
            autoFocus={mode === "login"}
          />
        </label>

        <label className="auth-field">
          <span>{t("auth.password")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            minLength={6}
            required
          />
        </label>

        {error && <div className="auth-error"><Icon name="alert" size={14} /> {error}</div>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "…" : mode === "login" ? t("auth.login") : t("auth.signup")}
        </button>

        <div className="auth-switch">
          {mode === "login" ? (
            <>
              {t("auth.noAccount")}{" "}
              <button type="button" onClick={() => { setMode("signup"); setError(null); }}>
                {t("auth.signup")}
              </button>
            </>
          ) : (
            <>
              {t("auth.haveAccount")}{" "}
              <button type="button" onClick={() => { setMode("login"); setError(null); }}>
                {t("auth.login")}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
