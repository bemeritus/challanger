//! Modul (feature) boshqaruvi — modullarni global (admin) va shaxsiy (foydalanuvchi)
//! darajada yoqib/o'chirish.
//!
//! Yagona manba — [`CATALOG`]. Yangi modul qo'shish uchun shu yerga bitta yozuv
//! qo'shiladi (va frontend'dagi `features.tsx` katalogiga mos kalit). Qolgan hamma
//! joy (sidebar, gate) shundan kelib chiqadi.
//!
//! Effektiv ko'rinish:  `global_enabled(key) AND NOT user_disabled(key)`.
//! Global o'chirilgan modul backend'da ham bloklanadi ([`feature_gate`]) — bu chin
//! "kill-switch". Shaxsiy yashirish esa faqat UI darajasida (ma'lumotga xavfsizlik
//! chegarasi emas, shunchaki qulaylik).

use std::collections::HashSet;
use std::sync::{Arc, RwLock};

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::put;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::AppState;
use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};

/// Bitta modul ta'rifi.
pub struct Feature {
    /// Barqaror kalit (frontend bilan bir xil bo'lishi shart).
    pub key: &'static str,
    /// Inson o'qiydigan nom (admin paneli uchun; UI odatda i18n ishlatadi).
    pub label: &'static str,
    /// Shu modulga tegishli API yo'l prefikslari (`/api` olib tashlangan holda).
    /// Global o'chirilganda shu prefikslar 403 qaytaradi. Bo'sh — modul faqat
    /// klient tomonida (alohida backend yo'q).
    pub route_prefixes: &'static [&'static str],
}

/// Barcha yoqib/o'chiriladigan modullar. Asosiy vazifa ro'yxati (bugun/kelgusi/…)
/// va sozlamalar bu yerda yo'q — ular o'chirilmaydigan yadro.
pub const CATALOG: &[Feature] = &[
    Feature { key: "calendar", label: "Kalendar", route_prefixes: &["/calendar"] },
    Feature { key: "eisenhower", label: "Eisenhower", route_prefixes: &[] },
    Feature { key: "habits", label: "Odatlar", route_prefixes: &["/habits"] },
    Feature { key: "groups", label: "Jamoa", route_prefixes: &["/groups"] },
    Feature { key: "stats", label: "Statistika", route_prefixes: &[] },
    Feature { key: "pomodoro", label: "Pomodoro", route_prefixes: &["/pomodoro"] },
    Feature { key: "countdown", label: "Sanoq", route_prefixes: &[] },
];

fn find(key: &str) -> Option<&'static Feature> {
    CATALOG.iter().find(|f| f.key == key)
}

/// Global o'chirilgan kalitlarning xotiradagi keshi (har so'rovda DB'ga bormaslik uchun).
/// `main.rs` ishga tushishda [`load`] bilan to'ldiradi, admin o'zgartirsa yangilanadi.
pub type GlobalFlags = Arc<RwLock<HashSet<String>>>;

/// Global o'chirilgan modullarni bazadan o'qib, kesh to'plamini quradi.
pub async fn load(db: &sqlx::PgPool) -> GlobalFlags {
    let disabled: HashSet<String> =
        sqlx::query_scalar::<_, String>("SELECT key FROM app_features WHERE enabled = false")
            .fetch_all(db)
            .await
            .unwrap_or_default()
            .into_iter()
            .collect();
    Arc::new(RwLock::new(disabled))
}

// ---------- Gate middleware ----------

/// Global o'chirilgan modulning API yo'lini bloklaydi (403). `/api` nest ichida
/// qo'llanadi, shuning uchun bu yerda yo'l `/habits`, `/pomodoro/...` ko'rinishida.
pub async fn feature_gate(State(st): State<AppState>, req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let blocked = {
        // Lock'ni await'dan oldin bo'shatamiz (std::sync RwLock await bo'ylab ushlanmaydi).
        let disabled = st.features.read().unwrap();
        disabled.iter().any(|key| {
            find(key).is_some_and(|f| {
                f.route_prefixes
                    .iter()
                    .any(|p| path == *p || path.starts_with(&format!("{p}/")))
            })
        })
    };
    if blocked {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "bu modul o'chirilgan" })),
        )
            .into_response();
    }
    next.run(req).await
}

// ---------- Javob modellari ----------

#[derive(Debug, Serialize)]
struct FeatureState {
    key: &'static str,
    label: &'static str,
    /// Global holat (admin boshqaradi). `false` — hamma uchun o'chiq.
    global_enabled: bool,
    /// Shu foydalanuvchi o'ziga yoqib qo'yganmi (yashirmaganmi).
    user_enabled: bool,
}

#[derive(Debug, Serialize)]
struct FeaturesResponse {
    features: Vec<FeatureState>,
    is_admin: bool,
}

#[derive(Debug, Deserialize)]
struct ToggleBody {
    key: String,
    enabled: bool,
}

// ---------- Router ----------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/features", axum::routing::get(list))
        .route("/features/me", put(set_mine))
        .route("/features/global", put(set_global))
}

/// Joriy foydalanuvchi uchun barcha modullar holati.
async fn list(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<FeaturesResponse>> {
    let row = sqlx::query_as::<_, (Vec<String>, bool)>(
        "SELECT disabled_features, is_admin FROM users WHERE id = $1",
    )
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?
    .ok_or(AppError::Unauthorized)?;
    let (user_disabled, is_admin) = row;

    let global_disabled = st.features.read().unwrap();
    let features = CATALOG
        .iter()
        .map(|f| FeatureState {
            key: f.key,
            label: f.label,
            global_enabled: !global_disabled.contains(f.key),
            user_enabled: !user_disabled.iter().any(|k| k == f.key),
        })
        .collect();

    Ok(Json(FeaturesResponse { features, is_admin }))
}

/// Foydalanuvchi modulni o'ziga yoqadi/yashiradi (shaxsiy opt-out).
async fn set_mine(
    State(st): State<AppState>,
    user: AuthUser,
    Json(body): Json<ToggleBody>,
) -> AppResult<Json<serde_json::Value>> {
    if find(&body.key).is_none() {
        return Err(AppError::BadRequest("noma'lum modul".into()));
    }
    // enabled=true  -> ro'yxatdan olib tashlash; enabled=false -> qo'shish.
    let sql = if body.enabled {
        "UPDATE users SET disabled_features = array_remove(disabled_features, $2) WHERE id = $1"
    } else {
        "UPDATE users SET disabled_features =
            (SELECT ARRAY(SELECT DISTINCT unnest(disabled_features || ARRAY[$2]))) WHERE id = $1"
    };
    sqlx::query(sql)
        .bind(user.id)
        .bind(&body.key)
        .execute(&st.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

/// Admin modulni butun ilova uchun yoqadi/o'chiradi (kill-switch).
async fn set_global(
    State(st): State<AppState>,
    user: AuthUser,
    Json(body): Json<ToggleBody>,
) -> AppResult<Json<serde_json::Value>> {
    if find(&body.key).is_none() {
        return Err(AppError::BadRequest("noma'lum modul".into()));
    }
    let is_admin: bool =
        sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1")
            .bind(user.id)
            .fetch_optional(&st.db)
            .await?
            .unwrap_or(false);
    if !is_admin {
        return Err(AppError::Unauthorized);
    }

    sqlx::query(
        "INSERT INTO app_features (key, enabled) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
    )
    .bind(&body.key)
    .bind(body.enabled)
    .execute(&st.db)
    .await?;

    // Keshni yangilaymiz — gate darhol kuchga kiradi.
    {
        let mut disabled = st.features.write().unwrap();
        if body.enabled {
            disabled.remove(&body.key);
        } else {
            disabled.insert(body.key.clone());
        }
    }
    Ok(Json(json!({ "ok": true })))
}
