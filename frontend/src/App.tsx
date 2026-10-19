import { useEffect, useState } from "react";
import { api, setUnauthorizedHandler, tokenStore } from "./api";
import type { User } from "./types";
import { AuthScreen } from "./components/AuthScreen";
import Workspace from "./Workspace";
import { FeaturesProvider } from "./features";
import { t } from "./i18n";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const logout = () => {
    // Serverdagi refresh tokenni ham bekor qilamiz (xato bo'lsa ham chiqamiz)
    const refresh = tokenStore.getRefresh();
    if (refresh) api.logout(refresh).catch(() => {});
    tokenStore.clear();
    setUser(null);
  };

  // 401 kelsa avtomatik chiqish
  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, []);

  // Saqlangan token bo'lsa — uni tekshiramiz
  useEffect(() => {
    if (!tokenStore.get()) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then((u) => setUser(u))
      .catch(() => tokenStore.clear())
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return <div className="loading">{t("app.loading")}</div>;
  }

  if (!user) {
    return <AuthScreen onAuth={setUser} />;
  }

  return (
    <FeaturesProvider>
      <Workspace user={user} onLogout={logout} onUserUpdate={setUser} />
    </FeaturesProvider>
  );
}
