//! Integratsiya testlari uchun umumiy yordamchilar (`mod common;` orqali ulanadi).
//!
//! Har bir test binari faqat kerakli yordamchilarni ishlatadi — shuning uchun
//! ishlatilmagan funksiyalar uchun dead_code ogohlantirishini o'chiramiz.
#![allow(dead_code)]

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{StatusCode, header};
use challanger::{AppState, build_app};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

/// Test uchun soddalashtirilgan ilova holati (Telegram/Push o'chiq).
pub fn app_with(pool: PgPool) -> Router {
    let state = AppState {
        db: pool,
        jwt_secret: Arc::new("test-secret-key-1234567890".into()),
        telegram: None,
        push: None,
        hub: challanger::realtime::Hub::new(),
        features: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashSet::new())),
    };
    build_app(state)
}

/// Bitta HTTP so'rov yuboradi va (status, JSON tanasi) ni qaytaradi.
pub async fn call(
    app: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut rb = axum::http::Request::builder().method(method).uri(uri);
    if let Some(tok) = token {
        rb = rb.header(header::AUTHORIZATION, format!("Bearer {tok}"));
    }
    let req = match body {
        Some(b) => rb
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(b.to_string()))
            .unwrap(),
        None => rb.body(Body::empty()).unwrap(),
    };
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let val = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, val)
}

/// Ro'yxatdan o'tkazadi va (access token, user_id) ni qaytaradi.
pub async fn signup(app: &Router, username: &str) -> (String, String) {
    let (st, v) = call(
        app,
        "POST",
        "/api/auth/signup",
        None,
        Some(json!({
            "username": username,
            "email": format!("{username}@example.com"),
            "password": "parol123",
        })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "signup muvaffaqiyatsiz: {v:?}");
    (
        v["token"].as_str().unwrap().to_string(),
        v["user"]["id"].as_str().unwrap().to_string(),
    )
}

/// Vazifa yaratadi (ixtiyoriy qo'shimcha maydonlar bilan) va to'liq JSON'ini qaytaradi.
pub async fn create_task_full(app: &Router, token: &str, body: Value) -> Value {
    let (st, v) = call(app, "POST", "/api/tasks", Some(token), Some(body)).await;
    assert_eq!(st, StatusCode::OK, "vazifa yaratilmadi: {v:?}");
    v
}

/// Oddiy sarlavhali vazifa yaratadi va id'sini qaytaradi.
pub async fn create_task(app: &Router, token: &str, title: &str) -> String {
    let v = create_task_full(app, token, json!({ "title": title })).await;
    v["id"].as_str().unwrap().to_string()
}

/// Guruh yaratadi; (group_id, invite_code) qaytaradi.
pub async fn create_group(app: &Router, token: &str) -> (String, String) {
    let (st, v) = call(
        app,
        "POST",
        "/api/groups",
        Some(token),
        Some(json!({ "name": "Jamoa" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "guruh yaratilmadi: {v:?}");
    (
        v["id"].as_str().unwrap().to_string(),
        v["invite_code"].as_str().unwrap().to_string(),
    )
}

/// Guruh odati yaratadi va id'sini qaytaradi.
pub async fn create_group_habit(app: &Router, token: &str, gid: &str) -> String {
    let (st, v) = call(
        app,
        "POST",
        &format!("/api/groups/{gid}/habits"),
        Some(token),
        Some(json!({ "name": "Sport" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "guruh odati yaratilmadi: {v:?}");
    v["id"].as_str().unwrap().to_string()
}
