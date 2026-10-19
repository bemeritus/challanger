-- Modul (feature) boshqaruvi.
-- Ikki qatlamli: GLOBAL (admin, hamma uchun kill-switch) + SHAXSIY (har foydalanuvchi
-- o'ziga yashiradi). Modul ko'rinadi  <=>  global_yoqilgan(key) AND user o'chirmagan(key).

-- Global holat. Qatori bo'lmagan kalit — sukut bo'yicha YOQILGAN hisoblanadi,
-- shuning uchun yangi modul qo'shilganda avtomatik yoqilgan bo'lib keladi.
CREATE TABLE app_features (
    key     TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT true
);

-- Har foydalanuvchi o'ziga yashirgan modullar ro'yxati (opt-out).
ALTER TABLE users ADD COLUMN disabled_features TEXT[] NOT NULL DEFAULT '{}';

-- Global modullarni boshqarish huquqi. Birinchi ro'yxatdan o'tgan foydalanuvchi
-- avtomatik admin bo'ladi (auth::signup'da), keyinchalik qo'lda ham berish mumkin.
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
