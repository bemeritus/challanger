# Deploy qo'llanmasi

Challanger — PostgreSQL + backend (Rust/Axum) + frontend (React) dan iborat.
Frontend build qilingach, backend uni bir xil manzildan (`/`) beradi — **alohida nginx
kerak emas**. Butun stek bitta `docker compose` bilan ko'tariladi.

---

## 1. Tez ishga tushirish (Docker)

Talab: **Docker** va **Docker Compose v2** (`docker compose ...`).

```bash
# 1. Muhit faylini tayyorlang
cp .env.docker.example .env

# 2. JWT_SECRET ni albatta kuchli qiymatga o'zgartiring
#    (release build JWT_SECRET yo'q yoki < 16 belgi bo'lsa ishga tushmaydi!)
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env

# 3. Ko'taring
docker compose up -d --build
```

- Ilova: <http://localhost:3000>
- Migratsiyalar konteyner ishga tushganda **avtomatik** qo'llanadi.
- Ma'lumotlar `pgdata` docker volume'ida saqlanadi (qayta ishga tushirishda yo'qolmaydi).

Holatni ko'rish / to'xtatish:

```bash
docker compose ps          # konteynerlar holati
docker compose logs -f app # ilova loglari
docker compose down        # to'xtatish (ma'lumot saqlanadi)
docker compose down -v     # ⚠️ to'xtatish + BAZANI O'CHIRISH
```

---

## 2. Muhit o'zgaruvchilari (`.env`)

`docker compose` `.env` faylini avtomatik o'qiydi.

| O'zgaruvchi | Majburiy | Standart | Tavsif |
|-------------|:--------:|----------|--------|
| `JWT_SECRET` | **Ha** (prod) | — | Token imzolash kaliti. **≥ 16 belgi**. `openssl rand -hex 32`. Yo'q/qisqa bo'lsa release build **panic** qiladi. |
| `POSTGRES_USER` | Yo'q | `challanger` | Baza foydalanuvchisi |
| `POSTGRES_PASSWORD` | Yo'q | `challanger` | Baza paroli (prodda o'zgartiring) |
| `POSTGRES_DB` | Yo'q | `challanger` | Baza nomi |
| `APP_PORT` | Yo'q | `3000` | Tashqi port (`host:APP_PORT → konteyner:3000`) |
| `TELEGRAM_BOT_TOKEN` | Yo'q | — | @BotFather tokeni. Bo'sh bo'lsa bot o'chiq. |
| `TELEGRAM_DIGEST_HOUR` | Yo'q | `3` | Kunlik xulosa yuboriladigan **UTC** soati (0–23) |
| `VAPID_PRIVATE_KEY` | Yo'q | — | Web Push maxfiy kaliti (base64url). Bo'sh bo'lsa push o'chiq. `scripts/genvapid.sh`. |
| `VAPID_SUBJECT` | Yo'q | `mailto:admin@challanger.app` | Push provayderlari uchun aloqa (mailto:). |
| `CORS_ALLOWED_ORIGINS` | Yo'q | *(barchasi ochiq)* | Vergul bilan ajratilgan ruxsat etilgan originlar. Prodda cheklang. |
| `RUST_LOG` | Yo'q | `challanger=info,tower_http=warn,info` | Log darajasi |
| `BIND_ADDR` | Yo'q | `0.0.0.0:3000` | Server tinglaydigan manzil (konteynerda) |

> `DATABASE_URL` `docker-compose.yml` ichida `db` xizmatiga avtomatik ulanadi —
> qo'lda o'rnatish shart emas.

**Prod uchun minimal `.env`:**

```bash
JWT_SECRET=<openssl rand -hex 32 natijasi>
POSTGRES_PASSWORD=<kuchli parol>
# Ilova alohida domenda bo'lsa:
CORS_ALLOWED_ORIGINS=https://challanger.example.com
```

---

## 3. HTTPS (reverse-proxy)

`app` konteyner 3000-portda oddiy HTTP beradi. Prodda oldiga **nginx** yoki **Caddy**
qo'yib HTTPS qo'shing.

**Caddy misoli** (`Caddyfile`):

```
challanger.example.com {
    reverse_proxy localhost:3000
}
```

**nginx misoli:**

```nginx
server {
    server_name challanger.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> ⚠️ Rate limiting `X-Forwarded-For` / `X-Real-IP` sarlavhasiga tayanadi. Reverse-proxy
> bu sarlavhalarni **qayta yozishi** (append emas) kerak, aks holda klient soxta IP bilan
> limitni chetlab o'tishi mumkin. Yuqoridagi konfiglar buni to'g'ri bajaradi.

---

## 4. Yangilash (update)

```bash
git pull
docker compose up -d --build   # qayta build + qayta ishga tushirish
```

Migratsiyalar startda avtomatik qo'llanadi. Eski image'larni tozalash:

```bash
docker image prune -f
```

### Modullar va admin (0017 migratsiyasidan keyin — bir martalik)

Ilovada endi **modullarni UI orqali yoqib/o'chirish** mumkin: har foydalanuvchi o'ziga
yashiradi, **admin** esa butun ilova uchun o'chira oladi (global kill-switch).

Admin huquqi **birinchi ro'yxatdan o'tgan** foydalanuvchiga avtomatik beriladi. Ammo
**mavjud** bazada (allaqachon foydalanuvchilar bor) hech kim admin bo'lmaydi — shuning
uchun deploy'dan keyin o'z akkauntingizni bir marta qo'lda admin qiling:

```bash
docker compose exec db \
  psql -U challanger -d challanger \
  -c "UPDATE users SET is_admin = true WHERE username = 'SIZNING_USERNAME';"
```

> Bu faqat **global** boshqaruv uchun kerak. Shaxsiy "modulni yashirish" har bir
> foydalanuvchiga adminliksiz ham ishlaydi.

---

## 5. Zaxira (backup) va tiklash

Baza `pgdata` volume'ida. `pg_dump` bilan zaxira:

```bash
# Zaxira olish
docker compose exec -T db pg_dump -U challanger challanger > backup-$(date +%F).sql

# Tiklash (⚠️ mavjud ma'lumot ustiga)
cat backup-2026-09-10.sql | docker compose exec -T db psql -U challanger challanger
```

> Foydalanuvchilar ilova ichidan ham **Sozlamalar → Ma'lumotlar (zaxira)** orqali
> shaxsiy ma'lumotlarini JSON'ga eksport/import qila oladi.

---

## 6. Telegram bot (ixtiyoriy)

1. [@BotFather](https://t.me/BotFather) → `/newbot` → tokenni oling.
2. `.env` ga qo'shing: `TELEGRAM_BOT_TOKEN=123456:ABC-DEF...`
3. `docker compose up -d` (qayta ishga tushiring). Logda `🤖 Telegram bot yoqildi` chiqadi.

Bot **long polling** (`getUpdates`) ishlatadi — public webhook URL kerak emas, shuning
uchun self-hosted serverda ham ishlaydi. Token berilmasa ilova baribir ishlaydi.

---

## 7. Docker'siz (mahalliy ishlab chiqish)

Nix + direnv orqali (batafsil: asosiy `README.md`):

```bash
direnv allow                 # yoki: nix develop  (Rust, Node, pnpm, PostgreSQL beradi)
cd frontend && pnpm install && cd ..
scripts/dev.sh               # baza + backend + frontend birga
```

- Backend: <http://127.0.0.1:3000> · Frontend (dev): <http://localhost:5173>
- Backend `.env`i: `backend/.env` (namuna: `backend/.env.example`).

---

## 8. Web Push (brauzer bildirishnomasi) — ixtiyoriy

Ilova **yopiq bo'lsa ham** keladigan bildirishnoma. To'liq **bepul** — Google/Mozilla/Apple
push serverlari orqali, VAPID standarti (hech qanday uchinchi tomon xizmati kerak emas).

1. **VAPID kalitini yarating** (bir marta):

   ```bash
   scripts/genvapid.sh
   # -> VAPID_PRIVATE_KEY=... ni nusxa oling (faqat maxfiy kalit kerak,
   #    ochiq kalitni server o'zi hosil qiladi)
   ```

2. **`.env` ga qo'shing**:

   ```
   VAPID_PRIVATE_KEY=<yuqoridagi qiymat>
   VAPID_SUBJECT=mailto:siz@example.com
   ```

3. Konteynerni qayta quring:

   ```bash
   docker compose up -d --build app
   ```

   Logda `🔔 Web Push yoqildi (VAPID)` chiqadi. Foydalanuvchi **Sozlamalar →
   Bildirishnomalar → "Push'ni yoqish"** tugmasi orqali obuna bo'ladi.

**Qanday ishlaydi:** eslatma vaqti yetganda server bir vazifani ham Telegram, ham Web Push'ga
yuboradi (ikkalasi ixtiyoriy). `VAPID_PRIVATE_KEY` bo'sh bo'lsa push o'chiq turadi —
tugma ko'rinmaydi, eslatmalar avvalgidek Telegram orqali ketaveradi.

> ⚠️ **HTTPS shart.** Web Push faqat `https://` (yoki dev'da `localhost`) da ishlaydi —
> shuning uchun push uchun 3-bo'limdagi reverse-proxy (HTTPS) sozlangan bo'lishi kerak.
> Kalit uzoq muddatli: `VAPID_PRIVATE_KEY` ni o'zgartirsangiz mavjud obunalar yaroqsiz bo'ladi.

---

## 9. Muammolarni bartaraf etish

| Alomat | Sabab / yechim |
|--------|----------------|
| Konteyner darrov o'chadi, logda `JWT_SECRET` panic | `.env` da `JWT_SECRET` yo'q yoki < 16 belgi — kuchli qiymat bering |
| `db` "unhealthy" | Baza hali ko'tarilmagan; `depends_on: healthy` kutadi — birinchi startda biroz kuting |
| 502 (reverse-proxy) | `app` hali ishga tushmagan yoki port noto'g'ri; `docker compose logs app` |
| Frontend ochiladi, API 401/CORS xatosi | Alohida domen ishlatsangiz `CORS_ALLOWED_ORIGINS` ni to'g'ri bering |
| Push tugmasi ko'rinmaydi | `VAPID_PRIVATE_KEY` o'rnatilmagan yoki logda `Web Push o'chirilgan` — kalit qo'shib qayta build qiling |
| "Push'ni yoqish" ishlamaydi / obuna bo'lmaydi | Sayt HTTPS'da emas (yoki `localhost` emas); brauzer bildirishnomani bloklagan bo'lishi mumkin |
| Loglarni ko'rish | `docker compose logs -f app` / `docker compose logs -f db` |

---

## Tegishli fayllar

- `docker-compose.yml` — stek ta'rifi (db + app)
- `Dockerfile` — 3 bosqichli build (frontend → backend → runtime)
- `.env.docker.example` — muhit namunasi
- `.dockerignore` — build kontekstidan chiqarib tashlanadigan fayllar
- `scripts/genvapid.sh` — Web Push uchun VAPID kalitini yaratadi
