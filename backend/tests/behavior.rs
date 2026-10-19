//! Integratsiya testlari — funksional to'g'rilik (IDOR emas, "feature ishlayaptimi").
//!
//! Qisman yangilash semantikasi, takrorlanuvchi vazifa oqimi, validatsiya xatolari
//! va odat toggle idempotentligini tekshiradi.

mod common;

use axum::http::StatusCode;
use common::*;
use serde_json::json;
use sqlx::PgPool;

// ------------------------- Qisman yangilash (PATCH) -------------------------

#[sqlx::test]
async fn partial_update_preserves_untouched_fields(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;
    let task = create_task_full(
        &app,
        &alice,
        json!({
            "title": "boshlang'ich",
            "notes": "eslatma matni",
            "due_date": "2026-09-15T10:00:00Z",
            "priority": 2,
        }),
    )
    .await;
    let id = task["id"].as_str().unwrap();

    // Faqat sarlavhani yangilaymiz — qolganlari o'zgarmasligi kerak.
    let (st, v) = call(
        &app,
        "PATCH",
        &format!("/api/tasks/{id}"),
        Some(&alice),
        Some(json!({ "title": "yangilangan" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v:?}");
    assert_eq!(v["title"], "yangilangan");
    assert_eq!(v["notes"], "eslatma matni", "izoh o'chib ketmasligi kerak");
    assert_eq!(v["priority"], 2, "prioritet saqlanishi kerak");
    assert!(
        v["due_date"].is_string(),
        "muddat saqlanishi kerak, topildi: {:?}",
        v["due_date"]
    );
}

#[sqlx::test]
async fn partial_update_can_clear_due_date_with_null(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;
    let task = create_task_full(
        &app,
        &alice,
        json!({ "title": "muddatli", "due_date": "2026-09-15T10:00:00Z" }),
    )
    .await;
    let id = task["id"].as_str().unwrap();

    // `null` yuborilsa — muddat tozalanadi (double_option Some(None)).
    let (st, v) = call(
        &app,
        "PATCH",
        &format!("/api/tasks/{id}"),
        Some(&alice),
        Some(json!({ "due_date": null })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v:?}");
    assert!(v["due_date"].is_null(), "muddat null bo'lishi kerak");
}

#[sqlx::test]
async fn completing_and_uncompleting_updates_completed_at(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;
    let id = create_task(&app, &alice, "vazifa").await;

    let (_, v) = call(
        &app,
        "PATCH",
        &format!("/api/tasks/{id}"),
        Some(&alice),
        Some(json!({ "completed": true })),
    )
    .await;
    assert_eq!(v["completed"], true);
    assert!(
        v["completed_at"].is_string(),
        "completed_at o'rnatilishi kerak"
    );

    let (_, v) = call(
        &app,
        "PATCH",
        &format!("/api/tasks/{id}"),
        Some(&alice),
        Some(json!({ "completed": false })),
    )
    .await;
    assert_eq!(v["completed"], false);
    assert!(
        v["completed_at"].is_null(),
        "completed_at tozalanishi kerak"
    );
}

// ------------------------- Takrorlanuvchi vazifa -------------------------

#[sqlx::test]
async fn completing_recurring_task_advances_due_date(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;
    let task = create_task_full(
        &app,
        &alice,
        json!({ "title": "kunlik", "due_date": "2026-09-15T10:00:00Z", "recurrence": "daily" }),
    )
    .await;
    let id = task["id"].as_str().unwrap();

    // Takrorlanuvchi vazifa "bajarildi" bo'lmaydi — muddati keyingi kunga suriladi.
    let (st, v) = call(
        &app,
        "POST",
        &format!("/api/tasks/{id}/complete"),
        Some(&alice),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v:?}");
    assert_eq!(v["completed"], false, "takrorlanuvchi bajarilgan bo'lmaydi");
    assert!(
        v["due_date"].as_str().unwrap().starts_with("2026-09-16"),
        "muddat keyingi kunga surilishi kerak, topildi: {:?}",
        v["due_date"]
    );
}

#[sqlx::test]
async fn completing_normal_task_marks_it_done(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;
    let id = create_task(&app, &alice, "bir martalik").await;

    let (st, v) = call(
        &app,
        "POST",
        &format!("/api/tasks/{id}/complete"),
        Some(&alice),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v:?}");
    assert_eq!(v["completed"], true);
    assert!(v["completed_at"].is_string());
}

// ------------------------- Validatsiya (400) -------------------------

#[sqlx::test]
async fn signup_rejects_invalid_input(pool: PgPool) {
    let app = app_with(pool);

    // Zaif parol (< 6).
    let (st, _) = call(
        &app,
        "POST",
        "/api/auth/signup",
        None,
        Some(json!({ "username": "aaa", "email": "a@b.com", "password": "123" })),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "zaif parol rad etilishi kerak");

    // Noto'g'ri email (@ yo'q).
    let (st, _) = call(
        &app,
        "POST",
        "/api/auth/signup",
        None,
        Some(json!({ "username": "bbb", "email": "notanemail", "password": "parol123" })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "noto'g'ri email rad etilishi kerak"
    );

    // Juda qisqa username (< 3 belgi). (Eslatma: katta harf rad etilmaydi —
    // signup avval kichik harfga o'tkazadi, bu ataylab shunday.)
    let (st, _) = call(
        &app,
        "POST",
        "/api/auth/signup",
        None,
        Some(json!({ "username": "ab", "email": "c@b.com", "password": "parol123" })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "juda qisqa username rad etilishi kerak"
    );
}

#[sqlx::test]
async fn signup_rejects_duplicate_username(pool: PgPool) {
    let app = app_with(pool);
    signup(&app, "alice").await;
    // Xuddi shu username bilan ikkinchi marta — 400.
    let (st, _) = call(
        &app,
        "POST",
        "/api/auth/signup",
        None,
        Some(json!({ "username": "alice", "email": "boshqa@b.com", "password": "parol123" })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "takroriy username rad etilishi kerak"
    );
}

#[sqlx::test]
async fn create_rejects_bad_input(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;

    // Bo'sh sarlavha.
    let (st, _) = call(
        &app,
        "POST",
        "/api/tasks",
        Some(&alice),
        Some(json!({ "title": "   " })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "bo'sh sarlavha rad etilishi kerak"
    );

    // Noto'g'ri rang formati.
    let (st, _) = call(
        &app,
        "POST",
        "/api/projects",
        Some(&alice),
        Some(json!({ "name": "Loyiha", "color": "qizil" })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "noto'g'ri rang rad etilishi kerak"
    );
}

// ------------------------- Odat toggle idempotentligi -------------------------

#[sqlx::test]
async fn habit_toggle_is_idempotent(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;
    let (st, v) = call(
        &app,
        "POST",
        "/api/habits",
        Some(&alice),
        Some(json!({ "name": "Suv ichish" })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{v:?}");
    let hid = v["id"].as_str().unwrap();
    let today = chrono::Utc::now().date_naive().to_string();

    // Birinchi toggle — belgilanadi.
    let (st, v) = call(
        &app,
        "POST",
        &format!("/api/habits/{hid}/toggle"),
        Some(&alice),
        Some(json!({ "day": today })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["done"], true, "birinchi toggle belgilashi kerak");

    // Ikkinchi toggle — belgi olib tashlanadi.
    let (st, v) = call(
        &app,
        "POST",
        &format!("/api/habits/{hid}/toggle"),
        Some(&alice),
        Some(json!({ "day": today })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        v["done"], false,
        "ikkinchi toggle belgini olib tashlashi kerak"
    );
}

// ------------------------- Modullar (features) -------------------------

#[sqlx::test]
async fn first_user_is_admin_and_sees_full_catalog(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;

    let (st, v) = call(&app, "GET", "/api/features", Some(&alice), None).await;
    assert_eq!(st, StatusCode::OK);
    // Birinchi ro'yxatdan o'tgan — admin.
    assert_eq!(v["is_admin"], true, "birinchi foydalanuvchi admin bo'lishi kerak");
    // Katalog to'liq va hammasi dastlab yoqilgan.
    let feats = v["features"].as_array().unwrap();
    assert_eq!(feats.len(), 7);
    assert!(feats.iter().all(|f| f["global_enabled"] == true && f["user_enabled"] == true));

    // Keyingi foydalanuvchi admin emas.
    let (bob, _) = signup(&app, "bob").await;
    let (_, v) = call(&app, "GET", "/api/features", Some(&bob), None).await;
    assert_eq!(v["is_admin"], false);
}

#[sqlx::test]
async fn admin_global_disable_blocks_module_api(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await; // admin

    // Dastlab habits API ochiq.
    let (st, _) = call(&app, "GET", "/api/habits", Some(&alice), None).await;
    assert_eq!(st, StatusCode::OK);

    // Admin habits modulini butun ilova uchun o'chiradi.
    let (st, _) = call(
        &app,
        "PUT",
        "/api/features/global",
        Some(&alice),
        Some(json!({ "key": "habits", "enabled": false })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    // Endi gate API'ni bloklaydi.
    let (st, _) = call(&app, "GET", "/api/habits", Some(&alice), None).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "o'chirilgan modul 403 qaytarishi kerak");

    // Qayta yoqilsa — yana ishlaydi.
    let (st, _) = call(
        &app,
        "PUT",
        "/api/features/global",
        Some(&alice),
        Some(json!({ "key": "habits", "enabled": true })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&app, "GET", "/api/habits", Some(&alice), None).await;
    assert_eq!(st, StatusCode::OK);
}

#[sqlx::test]
async fn non_admin_cannot_toggle_global(pool: PgPool) {
    let app = app_with(pool);
    let (_alice, _) = signup(&app, "alice").await; // admin
    let (bob, _) = signup(&app, "bob").await; // oddiy foydalanuvchi

    let (st, _) = call(
        &app,
        "PUT",
        "/api/features/global",
        Some(&bob),
        Some(json!({ "key": "habits", "enabled": false })),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "admin bo'lmagan global o'zgartira olmaydi");
}

#[sqlx::test]
async fn user_hide_is_cosmetic_not_gated(pool: PgPool) {
    let app = app_with(pool);
    let (alice, _) = signup(&app, "alice").await;

    // Foydalanuvchi pomodoro modulini o'ziga yashiradi.
    let (st, _) = call(
        &app,
        "PUT",
        "/api/features/me",
        Some(&alice),
        Some(json!({ "key": "pomodoro", "enabled": false })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    // /features'da user_enabled=false ko'rinadi.
    let (_, v) = call(&app, "GET", "/api/features", Some(&alice), None).await;
    let pomo = v["features"].as_array().unwrap().iter().find(|f| f["key"] == "pomodoro").unwrap();
    assert_eq!(pomo["user_enabled"], false);
    assert_eq!(pomo["global_enabled"], true);

    // Shaxsiy yashirish faqat UI — API baribir ishlaydi (gate qilinmaydi).
    let (st, _) = call(&app, "GET", "/api/pomodoro", Some(&alice), None).await;
    assert_eq!(st, StatusCode::OK);
}
