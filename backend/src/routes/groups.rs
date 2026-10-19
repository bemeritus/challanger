use std::collections::HashMap;
use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::{AppState, validate};

// ---------- Modellar ----------

#[derive(Debug, Serialize, FromRow)]
struct GroupSummary {
    id: Uuid,
    name: String,
    emoji: String,
    invite_code: String,
    owner_id: Uuid,
    role: String,
    member_count: i64,
}

#[derive(Debug, Serialize, FromRow)]
struct MemberInfo {
    user_id: Uuid,
    username: String,
    role: String,
    joined_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
struct GroupHabitRow {
    id: Uuid,
    name: String,
    color: String,
    frequency: String,
    target_per_week: i16,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct GroupHabitInfo {
    #[serde(flatten)]
    habit: GroupHabitRow,
    /// user_id -> bajarilgan kunlar (oxirgi 90 kun)
    entries: HashMap<Uuid, Vec<String>>,
    /// emoji -> reaksiya bergan foydalanuvchilar soni
    reactions: HashMap<String, i64>,
    /// joriy foydalanuvchi bosgan emoji'lar
    my_reactions: Vec<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct GroupTaskInfo {
    id: Uuid,
    title: String,
    done: bool,
    created_by: Option<Uuid>,
    done_by: Option<Uuid>,
    assigned_to: Option<Uuid>,
    due_date: Option<DateTime<Utc>>,
    reminder_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
struct ActivityInfo {
    id: Uuid,
    text: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
struct MessageInfo {
    id: Uuid,
    user_id: Option<Uuid>,
    username: String,
    text: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
struct ChallengeInfo {
    id: Uuid,
    title: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(Debug, Serialize)]
struct GroupDetail {
    id: Uuid,
    name: String,
    emoji: String,
    description: String,
    invite_code: String,
    owner_id: Uuid,
    my_role: String,
    members: Vec<MemberInfo>,
    habits: Vec<GroupHabitInfo>,
    tasks: Vec<GroupTaskInfo>,
    messages: Vec<MessageInfo>,
    challenges: Vec<ChallengeInfo>,
    activity: Vec<ActivityInfo>,
}

#[derive(Debug, Deserialize)]
struct CreateGroup {
    name: String,
}

#[derive(Debug, Deserialize)]
struct UpdateGroup {
    name: Option<String>,
    emoji: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AddMember {
    username: String,
}

#[derive(Debug, Deserialize)]
struct SetRole {
    role: String, // 'member' | 'admin' | 'owner' (owner = egalikni uzatish)
}

#[derive(Debug, Deserialize)]
struct JoinGroup {
    code: String,
}

#[derive(Debug, Deserialize)]
struct CreateGroupHabit {
    name: String,
    #[serde(default = "default_color")]
    color: String,
    #[serde(default = "default_frequency")]
    frequency: String,
    #[serde(default = "default_target")]
    target_per_week: i16,
}

#[derive(Debug, Deserialize)]
struct ToggleBody {
    day: NaiveDate,
}

#[derive(Debug, Deserialize)]
struct CreateGroupTask {
    title: String,
    #[serde(default)]
    assigned_to: Option<Uuid>,
    #[serde(default)]
    due_date: Option<DateTime<Utc>>,
    #[serde(default)]
    reminder_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
struct UpdateGroupTask {
    // double_option: Some(None) => tozalash, None => tegmaslik
    #[serde(default, deserialize_with = "double_option")]
    assigned_to: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "double_option")]
    due_date: Option<Option<DateTime<Utc>>>,
    #[serde(default, deserialize_with = "double_option")]
    reminder_at: Option<Option<DateTime<Utc>>>,
}

fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Debug, Deserialize)]
struct ReactBody {
    emoji: String,
}

#[derive(Debug, Deserialize)]
struct NudgeBody {
    user_id: Uuid,
    #[serde(default)]
    habit_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SendMessage {
    text: String,
}

#[derive(Debug, Deserialize)]
struct CreateChallenge {
    title: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

fn default_color() -> String {
    "#10b981".into()
}
fn default_frequency() -> String {
    "daily".into()
}
fn default_target() -> i16 {
    7
}

// ---------- Router ----------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/groups", get(list_groups).post(create_group))
        .route("/groups/join", post(join_group))
        .route(
            "/groups/{id}",
            get(get_group).patch(update_group).delete(delete_group),
        )
        .route("/groups/{id}/regenerate", post(regenerate_code))
        .route("/groups/{id}/members", post(add_member))
        .route(
            "/groups/{id}/members/{uid}",
            axum::routing::delete(remove_member),
        )
        .route("/groups/{id}/members/{uid}/role", post(set_role))
        .route("/groups/{id}/leave", post(leave_group))
        .route("/groups/{id}/events", get(group_events))
        .route("/groups/{id}/nudge", post(nudge))
        .route("/groups/{id}/habits", post(create_group_habit))
        .route(
            "/groups/{id}/habits/{hid}",
            axum::routing::delete(delete_group_habit),
        )
        .route("/group-habits/{id}/toggle", post(toggle_group_habit))
        .route("/group-habits/{id}/react", post(react_group_habit))
        .route("/groups/{id}/tasks", post(create_group_task))
        .route(
            "/group-tasks/{id}",
            patch(update_group_task).delete(delete_group_task),
        )
        .route("/group-tasks/{id}/toggle", post(toggle_group_task))
        .route("/groups/{id}/messages", post(send_group_message))
        .route(
            "/group-messages/{id}",
            axum::routing::delete(delete_group_message),
        )
        .route("/groups/{id}/challenges", post(create_challenge))
        .route(
            "/group-challenges/{id}",
            axum::routing::delete(delete_challenge),
        )
}

// ---------- Yordamchilar ----------

async fn require_member(st: &AppState, group_id: Uuid, user_id: Uuid) -> AppResult<String> {
    let role: Option<String> =
        sqlx::query_scalar("SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2")
            .bind(group_id)
            .bind(user_id)
            .fetch_optional(&st.db)
            .await?;
    role.ok_or(AppError::NotFound)
}

async fn require_owner(st: &AppState, group_id: Uuid, user_id: Uuid) -> AppResult<()> {
    if require_member(st, group_id, user_id).await? != "owner" {
        return Err(AppError::BadRequest(
            "faqat guruh egasi buni qila oladi".into(),
        ));
    }
    Ok(())
}

/// Guruhni boshqara oladiganlar: ega yoki admin (odat/vazifa/profil boshqaruvi).
async fn require_manager(st: &AppState, group_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let role = require_member(st, group_id, user_id).await?;
    if role == "owner" || role == "admin" {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "faqat ega yoki admin buni qila oladi".into(),
        ))
    }
}

fn invite_code() -> String {
    Uuid::new_v4().simple().to_string()[..8].to_uppercase()
}

/// Guruh faoliyat tasmasiga yozuv qo'shadi (xatolarni jimgina yutadi).
async fn log_activity(st: &AppState, group_id: Uuid, text: impl Into<String>) {
    let _ = sqlx::query("INSERT INTO group_activity (group_id, text) VALUES ($1, $2)")
        .bind(group_id)
        .bind(text.into())
        .execute(&st.db)
        .await;
}

async fn username_of(st: &AppState, user_id: Uuid) -> String {
    sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&st.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "kimdir".into())
}

// ---------- Handlerlar ----------

async fn list_groups(
    State(st): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<GroupSummary>>> {
    let rows = sqlx::query_as::<_, GroupSummary>(
        "SELECT g.id, g.name, g.emoji, g.invite_code, g.owner_id, gm.role,
                (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = $1
         ORDER BY g.created_at DESC",
    )
    .bind(user.id)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(rows))
}

async fn create_group(
    State(st): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateGroup>,
) -> AppResult<Json<GroupSummary>> {
    let name = validate::required_text("guruh nomi", &body.name, validate::MAX_NAME)?;
    let mut tx = st.db.begin().await?;
    let group_id: Uuid = sqlx::query_scalar(
        "INSERT INTO groups (name, owner_id, invite_code) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(name)
    .bind(user.id)
    .bind(invite_code())
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')")
        .bind(group_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let summary = sqlx::query_as::<_, GroupSummary>(
        "SELECT g.id, g.name, g.emoji, g.invite_code, g.owner_id, gm.role,
                (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
         FROM groups g JOIN group_members gm ON gm.group_id = g.id
         WHERE g.id = $1 AND gm.user_id = $2",
    )
    .bind(group_id)
    .bind(user.id)
    .fetch_one(&st.db)
    .await?;
    Ok(Json(summary))
}

/// Guruh profilini yangilash (nom / emoji / tavsif) — ega yoki admin.
async fn update_group(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateGroup>,
) -> AppResult<Json<serde_json::Value>> {
    require_manager(&st, id, user.id).await?;
    let name = match body.name {
        Some(n) => Some(validate::required_text(
            "guruh nomi",
            &n,
            validate::MAX_NAME,
        )?),
        None => None,
    };
    // Emoji — 1..=8 belgi (bir nechta emoji ham bo'lishi mumkin).
    let emoji = body
        .emoji
        .map(|e| e.chars().take(8).collect::<String>())
        .filter(|e| !e.trim().is_empty());
    let description = match body.description {
        Some(d) => Some(validate::optional_text("tavsif", &d, 500)?),
        None => None,
    };
    sqlx::query(
        "UPDATE groups SET
            name        = COALESCE($2, name),
            emoji       = COALESCE($3, emoji),
            description = COALESCE($4, description)
         WHERE id = $1",
    )
    .bind(id)
    .bind(name)
    .bind(emoji)
    .bind(description)
    .execute(&st.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Taklif kodini yangilaydi (eski kod ishlamay qoladi) — faqat ega.
async fn regenerate_code(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    require_owner(&st, id, user.id).await?;
    let code = invite_code();
    sqlx::query("UPDATE groups SET invite_code = $2 WHERE id = $1")
        .bind(id)
        .bind(&code)
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "invite_code": code })))
}

async fn get_group(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<GroupDetail>> {
    let my_role = require_member(&st, id, user.id).await?;

    let (name, emoji, description, invite_code, owner_id): (String, String, String, String, Uuid) =
        sqlx::query_as(
            "SELECT name, emoji, description, invite_code, owner_id FROM groups WHERE id = $1",
        )
        .bind(id)
        .fetch_one(&st.db)
        .await?;

    let members = sqlx::query_as::<_, MemberInfo>(
        "SELECT gm.user_id, u.username, gm.role, gm.joined_at
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1
         ORDER BY gm.role DESC, gm.joined_at",
    )
    .bind(id)
    .fetch_all(&st.db)
    .await?;

    let habit_rows = sqlx::query_as::<_, GroupHabitRow>(
        "SELECT id, name, color, frequency, target_per_week, created_at
         FROM group_habits WHERE group_id = $1 ORDER BY created_at",
    )
    .bind(id)
    .fetch_all(&st.db)
    .await?;

    // Barcha yozuvlar (oxirgi 90 kun) — bitta so'rovda
    let entries: Vec<(Uuid, Uuid, NaiveDate)> = sqlx::query_as(
        "SELECT e.group_habit_id, e.user_id, e.day
         FROM group_habit_entries e
         JOIN group_habits h ON h.id = e.group_habit_id
         WHERE h.group_id = $1 AND e.day >= (now()::date - INTERVAL '90 days')",
    )
    .bind(id)
    .fetch_all(&st.db)
    .await?;

    // Reaksiyalar (barcha odatlar bo'yicha bitta so'rovda)
    let reactions: Vec<(Uuid, String, Uuid)> = sqlx::query_as(
        "SELECT r.group_habit_id, r.emoji, r.user_id
         FROM group_habit_reactions r
         JOIN group_habits h ON h.id = r.group_habit_id
         WHERE h.group_id = $1",
    )
    .bind(id)
    .fetch_all(&st.db)
    .await?;

    let habits = habit_rows
        .into_iter()
        .map(|h| {
            let mut map: HashMap<Uuid, Vec<String>> = HashMap::new();
            for (hid, uid, day) in entries.iter() {
                if *hid == h.id {
                    map.entry(*uid).or_default().push(day.to_string());
                }
            }
            let mut rmap: HashMap<String, i64> = HashMap::new();
            let mut mine: Vec<String> = Vec::new();
            for (hid, emoji, uid) in reactions.iter() {
                if *hid == h.id {
                    *rmap.entry(emoji.clone()).or_default() += 1;
                    if *uid == user.id {
                        mine.push(emoji.clone());
                    }
                }
            }
            GroupHabitInfo {
                habit: h,
                entries: map,
                reactions: rmap,
                my_reactions: mine,
            }
        })
        .collect();

    let tasks = sqlx::query_as::<_, GroupTaskInfo>(
        "SELECT id, title, done, created_by, done_by, assigned_to, due_date, reminder_at, created_at
         FROM group_tasks WHERE group_id = $1 ORDER BY done, created_at DESC",
    )
    .bind(id)
    .fetch_all(&st.db)
    .await?;

    // Chat xabarlari — oxirgi 50 tasi, eskisidan yangisiga tartibda.
    let mut messages = sqlx::query_as::<_, MessageInfo>(
        "SELECT m.id, m.user_id, COALESCE(u.username, 'kimdir') AS username, m.text, m.created_at
         FROM group_messages m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.group_id = $1 ORDER BY m.created_at DESC LIMIT 50",
    )
    .bind(id)
    .fetch_all(&st.db)
    .await?;
    messages.reverse();

    let challenges = sqlx::query_as::<_, ChallengeInfo>(
        "SELECT id, title, start_date, end_date FROM group_challenges
         WHERE group_id = $1 AND end_date >= (now()::date - INTERVAL '7 days')
         ORDER BY start_date",
    )
    .bind(id)
    .fetch_all(&st.db)
    .await?;

    let activity = sqlx::query_as::<_, ActivityInfo>(
        "SELECT id, text, created_at FROM group_activity
         WHERE group_id = $1 ORDER BY created_at DESC LIMIT 30",
    )
    .bind(id)
    .fetch_all(&st.db)
    .await?;

    Ok(Json(GroupDetail {
        id,
        name,
        emoji,
        description,
        invite_code,
        owner_id,
        my_role,
        members,
        habits,
        tasks,
        messages,
        challenges,
        activity,
    }))
}

async fn add_member(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<AddMember>,
) -> AppResult<Json<serde_json::Value>> {
    require_owner(&st, id, user.id).await?;

    let username = body.username.trim().to_lowercase();
    let target: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&username)
        .fetch_optional(&st.db)
        .await?;
    let target =
        target.ok_or_else(|| AppError::BadRequest("bunday foydalanuvchi topilmadi".into()))?;

    let res = sqlx::query(
        "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)
         ON CONFLICT (group_id, user_id) DO NOTHING",
    )
    .bind(id)
    .bind(target)
    .execute(&st.db)
    .await?;
    if res.rows_affected() > 0 {
        log_activity(&st, id, format!("➕ {username} guruhga qo'shildi")).await;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// A'zo rolini o'zgartiradi: 'member' / 'admin', yoki 'owner' — egalikni uzatish. Faqat ega.
async fn set_role(
    State(st): State<AppState>,
    user: AuthUser,
    Path((id, uid)): Path<(Uuid, Uuid)>,
    Json(body): Json<SetRole>,
) -> AppResult<Json<serde_json::Value>> {
    require_owner(&st, id, user.id).await?;
    if uid == user.id {
        return Err(AppError::BadRequest(
            "o'z rolingizni o'zgartira olmaysiz".into(),
        ));
    }
    // Nishon a'zo shu guruhdami?
    require_member(&st, id, uid).await?;

    match body.role.as_str() {
        "member" | "admin" => {
            sqlx::query(
                "UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2 AND role <> 'owner'",
            )
            .bind(id)
            .bind(uid)
            .bind(&body.role)
            .execute(&st.db)
            .await?;
        }
        "owner" => {
            // Egalikni uzatish: eski ega 'admin' bo'ladi, yangi a'zo 'owner'.
            let mut tx = st.db.begin().await?;
            sqlx::query("UPDATE groups SET owner_id = $2 WHERE id = $1")
                .bind(id)
                .bind(uid)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2",
            )
            .bind(id)
            .bind(user.id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2",
            )
            .bind(id)
            .bind(uid)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            let uname = username_of(&st, uid).await;
            log_activity(&st, id, format!("👑 {uname} yangi ega bo'ldi")).await;
        }
        _ => return Err(AppError::BadRequest("noto'g'ri rol".into())),
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Guruh egasi boshqa a'zoni chiqarib yuboradi.
async fn remove_member(
    State(st): State<AppState>,
    user: AuthUser,
    Path((id, uid)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    require_owner(&st, id, user.id).await?;
    if uid == user.id {
        return Err(AppError::BadRequest(
            "o'zingizni chiqara olmaysiz — guruhni o'chiring".into(),
        ));
    }

    let mut tx = st.db.begin().await?;
    // A'zoning shu guruhdagi jamoaviy odat yozuvlarini tozalaymiz
    sqlx::query(
        "DELETE FROM group_habit_entries e
         USING group_habits h
         WHERE e.group_habit_id = h.id AND h.group_id = $1 AND e.user_id = $2",
    )
    .bind(id)
    .bind(uid)
    .execute(&mut *tx)
    .await?;

    let res = sqlx::query(
        "DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND role <> 'owner'",
    )
    .bind(id)
    .bind(uid)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if res.rows_affected() == 0 {
        return Err(AppError::BadRequest("a'zo topilmadi".into()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn join_group(
    State(st): State<AppState>,
    user: AuthUser,
    Json(body): Json<JoinGroup>,
) -> AppResult<Json<serde_json::Value>> {
    let code = body.code.trim().to_uppercase();
    let group_id: Option<Uuid> = sqlx::query_scalar("SELECT id FROM groups WHERE invite_code = $1")
        .bind(&code)
        .fetch_optional(&st.db)
        .await?;
    let group_id = group_id.ok_or_else(|| AppError::BadRequest("taklif kodi noto'g'ri".into()))?;

    let res = sqlx::query(
        "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)
         ON CONFLICT (group_id, user_id) DO NOTHING",
    )
    .bind(group_id)
    .bind(user.id)
    .execute(&st.db)
    .await?;
    if res.rows_affected() > 0 {
        let uname = username_of(&st, user.id).await;
        log_activity(&st, group_id, format!("➕ {uname} guruhga qo'shildi")).await;
    }
    Ok(Json(
        serde_json::json!({ "ok": true, "group_id": group_id }),
    ))
}

async fn leave_group(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let role = require_member(&st, id, user.id).await?;
    if role == "owner" {
        return Err(AppError::BadRequest(
            "egasi guruhni tark eta olmaydi — o'chiring".into(),
        ));
    }
    sqlx::query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2")
        .bind(id)
        .bind(user.id)
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn delete_group(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    require_owner(&st, id, user.id).await?;
    sqlx::query("DELETE FROM groups WHERE id = $1")
        .bind(id)
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// A'zoga "turtki" — odatni eslatuvchi bildirishnoma (faoliyat + Telegram).
async fn nudge(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<NudgeBody>,
) -> AppResult<Json<serde_json::Value>> {
    require_member(&st, id, user.id).await?;
    // Nishon a'zo shu guruhdami?
    require_member(&st, id, body.user_id).await?;
    if body.user_id == user.id {
        return Err(AppError::BadRequest("o'zingizga turtki bermang".into()));
    }

    let from = username_of(&st, user.id).await;
    let text = match body
        .habit_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(h) => format!("👉 {from} sizga turtki berdi: «{h}» ni bajaring!"),
        None => format!("👉 {from} sizga turtki berdi — odatlarni unutmang!"),
    };
    if let Some(bot) = &st.telegram {
        bot.notify_user(body.user_id, &text).await;
    }
    let to = username_of(&st, body.user_id).await;
    log_activity(&st, id, format!("👉 {from} → {to} turtki berdi")).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn create_group_habit(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateGroupHabit>,
) -> AppResult<Json<GroupHabitRow>> {
    require_member(&st, id, user.id).await?;
    let name = validate::required_text("nom", &body.name, validate::MAX_NAME)?;
    let color = validate::color(body.color)?;
    let freq = validate::frequency(&body.frequency);
    let row = sqlx::query_as::<_, GroupHabitRow>(
        "INSERT INTO group_habits (group_id, name, color, frequency, target_per_week)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, color, frequency, target_per_week, created_at",
    )
    .bind(id)
    .bind(name)
    .bind(color)
    .bind(freq)
    .bind(body.target_per_week.clamp(1, 7))
    .fetch_one(&st.db)
    .await?;
    let uname = username_of(&st, user.id).await;
    log_activity(
        &st,
        id,
        format!("🔥 {uname} yangi odat qo'shdi: {}", row.name),
    )
    .await;
    Ok(Json(row))
}

// ---------- Reaksiyalar ----------

/// Jamoaviy odatga emoji reaksiyasini almashtiradi (faqat a'zolar).
async fn react_group_habit(
    State(st): State<AppState>,
    user: AuthUser,
    Path(hid): Path<Uuid>,
    Json(body): Json<ReactBody>,
) -> AppResult<Json<serde_json::Value>> {
    let group_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT gh.group_id FROM group_habits gh
         JOIN group_members gm ON gm.group_id = gh.group_id AND gm.user_id = $2
         WHERE gh.id = $1",
    )
    .bind(hid)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    if group_id.is_none() {
        return Err(AppError::NotFound);
    }
    let emoji = body.emoji.chars().take(8).collect::<String>();
    if emoji.is_empty() {
        return Err(AppError::BadRequest("emoji bo'sh".into()));
    }

    let deleted = sqlx::query(
        "DELETE FROM group_habit_reactions WHERE group_habit_id = $1 AND user_id = $2 AND emoji = $3",
    )
    .bind(hid)
    .bind(user.id)
    .bind(&emoji)
    .execute(&st.db)
    .await?;

    let active = if deleted.rows_affected() == 0 {
        sqlx::query(
            "INSERT INTO group_habit_reactions (group_habit_id, user_id, emoji) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING",
        )
        .bind(hid)
        .bind(user.id)
        .bind(&emoji)
        .execute(&st.db)
        .await?;
        true
    } else {
        false
    };
    Ok(Json(
        serde_json::json!({ "emoji": emoji, "active": active }),
    ))
}

// ---------- Umumiy vazifalar ----------

async fn create_group_task(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateGroupTask>,
) -> AppResult<Json<GroupTaskInfo>> {
    require_member(&st, id, user.id).await?;
    let title = validate::required_text("vazifa", &body.title, validate::MAX_TITLE)?;
    // Mas'ul (agar berilgan bo'lsa) shu guruh a'zosi bo'lishi shart.
    if let Some(assignee) = body.assigned_to {
        require_member(&st, id, assignee).await?;
    }
    let row = sqlx::query_as::<_, GroupTaskInfo>(
        "INSERT INTO group_tasks (group_id, title, created_by, assigned_to, due_date, reminder_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, title, done, created_by, done_by, assigned_to, due_date, reminder_at, created_at",
    )
    .bind(id)
    .bind(title)
    .bind(user.id)
    .bind(body.assigned_to)
    .bind(body.due_date)
    .bind(body.reminder_at)
    .fetch_one(&st.db)
    .await?;
    Ok(Json(row))
}

/// Umumiy vazifa mas'uli / muddati / eslatmasini yangilaydi (faqat a'zolar).
async fn update_group_task(
    State(st): State<AppState>,
    user: AuthUser,
    Path(tid): Path<Uuid>,
    Json(body): Json<UpdateGroupTask>,
) -> AppResult<Json<GroupTaskInfo>> {
    let group_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT gt.group_id FROM group_tasks gt
         JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $2
         WHERE gt.id = $1",
    )
    .bind(tid)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    let group_id = group_id.ok_or(AppError::NotFound)?;

    // Yangi mas'ul (o'rnatilayotgan bo'lsa) shu guruh a'zosi bo'lsin.
    if let Some(Some(assignee)) = body.assigned_to {
        require_member(&st, group_id, assignee).await?;
    }

    let row = sqlx::query_as::<_, GroupTaskInfo>(
        "UPDATE group_tasks SET
            assigned_to   = CASE WHEN $2 THEN $3 ELSE assigned_to END,
            due_date      = CASE WHEN $4 THEN $5 ELSE due_date END,
            reminder_at   = CASE WHEN $6 THEN $7 ELSE reminder_at END,
            reminder_sent = CASE WHEN $6 THEN false ELSE reminder_sent END
         WHERE id = $1
         RETURNING id, title, done, created_by, done_by, assigned_to, due_date, reminder_at, created_at",
    )
    .bind(tid)
    .bind(body.assigned_to.is_some())
    .bind(body.assigned_to.flatten())
    .bind(body.due_date.is_some())
    .bind(body.due_date.flatten())
    .bind(body.reminder_at.is_some())
    .bind(body.reminder_at.flatten())
    .fetch_one(&st.db)
    .await?;
    Ok(Json(row))
}

/// Umumiy vazifa holatini almashtiradi (faqat a'zolar).
async fn toggle_group_task(
    State(st): State<AppState>,
    user: AuthUser,
    Path(tid): Path<Uuid>,
) -> AppResult<Json<GroupTaskInfo>> {
    // Vazifa qaysi guruhda va foydalanuvchi a'zomi?
    let group_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT gt.group_id FROM group_tasks gt
         JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $2
         WHERE gt.id = $1",
    )
    .bind(tid)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    let group_id = group_id.ok_or(AppError::NotFound)?;

    let row = sqlx::query_as::<_, GroupTaskInfo>(
        "UPDATE group_tasks SET
            done = NOT done,
            done_by = CASE WHEN NOT done THEN $2 ELSE NULL END
         WHERE id = $1
         RETURNING id, title, done, created_by, done_by, assigned_to, due_date, reminder_at, created_at",
    )
    .bind(tid)
    .bind(user.id)
    .fetch_one(&st.db)
    .await?;

    if row.done {
        let uname = username_of(&st, user.id).await;
        log_activity(&st, group_id, format!("✅ {uname} bajardi: {}", row.title)).await;
    }
    Ok(Json(row))
}

async fn delete_group_task(
    State(st): State<AppState>,
    user: AuthUser,
    Path(tid): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let res = sqlx::query(
        "DELETE FROM group_tasks gt
         USING group_members gm
         WHERE gt.id = $1 AND gm.group_id = gt.group_id AND gm.user_id = $2",
    )
    .bind(tid)
    .bind(user.id)
    .execute(&st.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn delete_group_habit(
    State(st): State<AppState>,
    user: AuthUser,
    Path((id, hid)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    require_manager(&st, id, user.id).await?;
    sqlx::query("DELETE FROM group_habits WHERE id = $1 AND group_id = $2")
        .bind(hid)
        .bind(id)
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Joriy foydalanuvchining shu kundagi belgisini almashtiradi (faqat a'zolar).
async fn toggle_group_habit(
    State(st): State<AppState>,
    user: AuthUser,
    Path(hid): Path<Uuid>,
    Json(body): Json<ToggleBody>,
) -> AppResult<Json<serde_json::Value>> {
    // Faqat bugungi (±1 kun) belgiga ruxsat — leaderboard soxtalashtirishning oldini oladi.
    validate::toggle_day(body.day)?;
    // Odat qaysi guruhga tegishli va foydalanuvchi a'zomi?
    let group_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT gh.group_id FROM group_habits gh
         JOIN group_members gm ON gm.group_id = gh.group_id AND gm.user_id = $2
         WHERE gh.id = $1",
    )
    .bind(hid)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    if group_id.is_none() {
        return Err(AppError::NotFound);
    }

    let deleted = sqlx::query(
        "DELETE FROM group_habit_entries WHERE group_habit_id = $1 AND user_id = $2 AND day = $3",
    )
    .bind(hid)
    .bind(user.id)
    .bind(body.day)
    .execute(&st.db)
    .await?;

    let done = if deleted.rows_affected() == 0 {
        // Bir vaqtdagi ikki so'rov ikkalasi ham 0 o'chirib INSERT qilsa — ON CONFLICT
        // bo'lmasa ikkinchisi PK (group_habit_id, user_id, day) buzilishi (500) beradi.
        sqlx::query(
            "INSERT INTO group_habit_entries (group_habit_id, user_id, day)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(hid)
        .bind(user.id)
        .bind(body.day)
        .execute(&st.db)
        .await?;
        true
    } else {
        false
    };
    Ok(Json(serde_json::json!({ "day": body.day, "done": done })))
}

// ---------- Chat ----------

#[derive(Debug, Deserialize)]
struct EventsQuery {
    /// Access token — `EventSource` maxsus header qo'ya olmagani uchun query orqali.
    token: String,
}

/// Guruh uchun real-vaqt hodisa oqimi (Server-Sent Events).
///
/// Brauzer `EventSource` bilan ulanadi; guruhda biror o'zgarish bo'lganda
/// (hozircha: chat xabari qo'shilishi/o'chirilishi) kichik signal keladi va
/// frontend guruh detalini qayta yuklaydi. Auth header qo'yib bo'lmagani uchun
/// token `?token=` query orqali kelib, shu yerda tekshiriladi.
async fn group_events(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<EventsQuery>,
) -> AppResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let user_id = crate::auth::verify_access_token(&st.jwt_secret, &q.token)?;
    require_member(&st, id, user_id).await?;

    let stream = BroadcastStream::new(st.hub.subscribe(id)).filter_map(|msg| match msg {
        Ok(data) => Some(Ok(Event::default().data(data))),
        // Tinglovchi sekin qolib `Lagged` bo'lsa — o'tkazib yuboramiz (ulanish uziladi emas).
        Err(_) => None,
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

async fn send_group_message(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SendMessage>,
) -> AppResult<Json<MessageInfo>> {
    require_member(&st, id, user.id).await?;
    let text = validate::required_text("xabar", &body.text, 1000)?;
    let row = sqlx::query_as::<_, MessageInfo>(
        "WITH ins AS (
            INSERT INTO group_messages (group_id, user_id, text)
            VALUES ($1, $2, $3) RETURNING id, user_id, text, created_at
         )
         SELECT ins.id, ins.user_id, u.username, ins.text, ins.created_at
         FROM ins JOIN users u ON u.id = ins.user_id",
    )
    .bind(id)
    .bind(user.id)
    .bind(text)
    .fetch_one(&st.db)
    .await?;
    // Guruhga ulangan boshqa a'zolarga yangi xabar haqida signal (realtime chat).
    st.hub.publish(id, r#"{"kind":"message"}"#);
    Ok(Json(row))
}

/// Xabarni o'chirish — muallif yoki ega/admin.
async fn delete_group_message(
    State(st): State<AppState>,
    user: AuthUser,
    Path(mid): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    // Xabar muallifi bo'lsa — o'chira oladi. Guruh id'sini signal uchun olamiz.
    let gid: Option<Uuid> = sqlx::query_scalar(
        "DELETE FROM group_messages WHERE id = $1 AND user_id = $2 RETURNING group_id",
    )
    .bind(mid)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    if let Some(g) = gid {
        st.hub.publish(g, r#"{"kind":"message"}"#);
        return Ok(Json(serde_json::json!({ "ok": true })));
    }
    // Aks holda — ega/admin bo'lsa o'chira oladi.
    let gid: Option<Uuid> = sqlx::query_scalar(
        "DELETE FROM group_messages m
         USING group_members gm
         WHERE m.id = $1 AND gm.group_id = m.group_id AND gm.user_id = $2
           AND gm.role IN ('owner', 'admin')
         RETURNING m.group_id",
    )
    .bind(mid)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    match gid {
        Some(g) => {
            st.hub.publish(g, r#"{"kind":"message"}"#);
            Ok(Json(serde_json::json!({ "ok": true })))
        }
        None => Err(AppError::NotFound),
    }
}

// ---------- Challenge ----------

async fn create_challenge(
    State(st): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateChallenge>,
) -> AppResult<Json<ChallengeInfo>> {
    require_manager(&st, id, user.id).await?;
    let title = validate::required_text("nom", &body.title, validate::MAX_NAME)?;
    if body.end_date < body.start_date {
        return Err(AppError::BadRequest(
            "tugash sanasi boshlanishdan oldin bo'lmasin".into(),
        ));
    }
    let row = sqlx::query_as::<_, ChallengeInfo>(
        "INSERT INTO group_challenges (group_id, title, start_date, end_date)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, start_date, end_date",
    )
    .bind(id)
    .bind(title)
    .bind(body.start_date)
    .bind(body.end_date)
    .fetch_one(&st.db)
    .await?;
    let uname = username_of(&st, user.id).await;
    log_activity(
        &st,
        id,
        format!("🏁 {uname} yangi challenge boshladi: {}", row.title),
    )
    .await;
    Ok(Json(row))
}

async fn delete_challenge(
    State(st): State<AppState>,
    user: AuthUser,
    Path(cid): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    // Challenge qaysi guruhda — va foydalanuvchi ega/adminmi?
    let group_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT gc.group_id FROM group_challenges gc
         JOIN group_members gm ON gm.group_id = gc.group_id AND gm.user_id = $2
         WHERE gc.id = $1 AND gm.role IN ('owner', 'admin')",
    )
    .bind(cid)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    if group_id.is_none() {
        return Err(AppError::NotFound);
    }
    sqlx::query("DELETE FROM group_challenges WHERE id = $1")
        .bind(cid)
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
