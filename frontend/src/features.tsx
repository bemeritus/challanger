// Modul (feature) holati — global (admin) + shaxsiy (foydalanuvchi) qatlamlar.
// Backend bilan bir xil kalitlar: calendar, eisenhower, habits, groups, stats,
// pomodoro, countdown. Yangi modul qo'shilganda shu yerga hech narsa qo'shish shart
// emas — ro'yxat serverdan keladi; yangi kalit sukut bo'yicha yoqilgan bo'lib keladi.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type FeatureState } from "./api";

interface FeaturesCtx {
  loaded: boolean;
  isAdmin: boolean;
  features: FeatureState[];
  /// Modul effektiv ko'rinadimi (global AND shaxsiy). Noma'lum kalit — yoqilgan deb hisoblanadi.
  isEnabled: (key: string) => boolean;
  /// Shaxsiy: modulni o'ziga yoqish/yashirish.
  setMine: (key: string, enabled: boolean) => Promise<void>;
  /// Admin: modulni butun ilova uchun yoqish/o'chirish.
  setGlobal: (key: string, enabled: boolean) => Promise<void>;
}

const Ctx = createContext<FeaturesCtx | null>(null);

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeatureState[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .features()
      .then((r) => {
        setFeatures(r.features);
        setIsAdmin(r.is_admin);
      })
      .catch(() => {
        /* xato — barcha modullar yoqilgan deb davom etamiz (isEnabled sukuti true) */
      })
      .finally(() => setLoaded(true));
  }, []);

  const isEnabled = useCallback(
    (key: string) => {
      const f = features.find((x) => x.key === key);
      // Topilmasa (yangi/noma'lum) — yoqilgan deb hisoblaymiz, UI buzilmasin.
      return f ? f.global_enabled && f.user_enabled : true;
    },
    [features]
  );

  const patch = (key: string, next: Partial<FeatureState>) =>
    setFeatures((fs) => fs.map((f) => (f.key === key ? { ...f, ...next } : f)));

  const setMine = useCallback(async (key: string, enabled: boolean) => {
    await api.setUserFeature(key, enabled);
    patch(key, { user_enabled: enabled });
  }, []);

  const setGlobal = useCallback(async (key: string, enabled: boolean) => {
    await api.setGlobalFeature(key, enabled);
    patch(key, { global_enabled: enabled });
  }, []);

  return (
    <Ctx.Provider value={{ loaded, isAdmin, features, isEnabled, setMine, setGlobal }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFeatures(): FeaturesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFeatures FeaturesProvider ichida ishlatilishi kerak");
  return ctx;
}
