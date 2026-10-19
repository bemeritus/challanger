//! Challanger backend kutubxonasi — modullar shu yerda e'lon qilinadi,
//! `main.rs` (server) va `tests/` (integratsiya testlari) undan foydalanadi.

pub mod auth;
pub mod error;
pub mod features;
pub mod models;
pub mod push;
pub mod realtime;
pub mod reminders;
pub mod routes;
pub mod telegram;
pub mod validate;

use std::sync::Arc;

use axum::Router;
use axum::routing::get;
use sqlx::PgPool;

use crate::telegram::TelegramBot;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub jwt_secret: Arc<String>,
    pub telegram: Option<Arc<TelegramBot>>,
    pub push: Option<Arc<push::WebPush>>,
    /// Guruh real-vaqt (SSE) hodisalarini tarqatuvchi xotiradagi hub.
    pub hub: realtime::Hub,
    /// Global o'chirilgan modullar keshi (feature gate shuni o'qiydi).
    pub features: features::GlobalFlags,
}

/// Barcha API route'larini birlashtiradi (rate-limit/CORS/static'siz).
///
/// `main.rs` prodda buning ustiga governor + CORS + static qatlamlarni qo'shadi;
/// `build_app` (testlar) esa toza holda ishlatadi. Yangi route qo'shsangiz —
/// `main.rs` dagi ro'yxatga ham qo'shing (prod uchun).
pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(auth::router())
        .merge(routes::projects::router())
        .merge(routes::tasks::router())
        .merge(routes::calendar::router())
        .merge(routes::habits::router())
        .merge(routes::pomodoro::router())
        .merge(routes::groups::router())
        .merge(routes::subtasks::router())
        .merge(routes::telegram::router())
        .merge(push::router())
        .merge(features::router())
}

/// Testlar uchun soddalashtirilgan ilova: `/api` ostidagi route'lar + holat.
/// Rate-limit, CORS va statik fayllar yo'q (testlarga xalaqit bermasligi uchun).
pub fn build_app(state: AppState) -> Router {
    let api = api_router().layer(axum::middleware::from_fn_with_state(
        state.clone(),
        features::feature_gate,
    ));
    Router::new().nest("/api", api).with_state(state)
}
