use argon2::Argon2;
use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use axum::extract::{FromRef, FromRequestParts, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::validate;

// ---------- Modellar ----------

#[derive(Debug, Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    #[serde(skip)]
    pub password_hash: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PublicUser {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub created_at: DateTime<Utc>,
}

impl From<User> for PublicUser {
    fn from(u: User) -> Self {
        PublicUser {
            id: u.id,
            username: u.username,
            email: u.email,
            created_at: u.created_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SignupBody {
    pub username: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub refresh_token: String,
    pub user: PublicUser,
}

#[derive(Debug, Deserialize)]
pub struct RefreshBody {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct RefreshResponse {
    pub token: String,
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfile {
    pub username: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePassword {
    pub current_password: String,
    pub new_password: String,
}

// ---------- JWT ----------

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String, // user id
    exp: u64,    // muddati (unix seconds) — 32-bit platformada ham 2038'dan keyin ishlaydi
}

/// Qisqa muddatli kirish (access) tokeni — 1 kun.
fn make_token(user_id: Uuid, secret: &str) -> AppResult<String> {
    let exp = (Utc::now() + chrono::Duration::days(1)).timestamp() as u64;
    let claims = Claims {
        sub: user_id.to_string(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| AppError::BadRequest("token yaratib bo'lmadi".into()))
}

/// Access token'ni tekshirib, undagi foydalanuvchi id'sini chiqaradi.
///
/// `AuthUser` extractor shuni ishlatadi; shuningdek `Authorization` header
/// qo'ya olmaydigan joylar (masalan, SSE `EventSource`, token `?token=` query
/// orqali keladi) uchun ham to'g'ridan-to'g'ri chaqiriladi.
pub fn verify_access_token(secret: &str, token: &str) -> AppResult<Uuid> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| AppError::Unauthorized)?;
    Uuid::parse_str(&data.claims.sub).map_err(|_| AppError::Unauthorized)
}

// ---------- Refresh token ----------

/// Refresh token'ni SHA-256 bilan hashlaydi (bazada faqat hash saqlanadi).
fn hash_refresh(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(token.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for b in digest {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

/// Yangi refresh token yaratib, uning hash'ini bazaga yozadi (30 kun). Ochiq tokenni qaytaradi.
async fn issue_refresh(db: &PgPool, user_id: Uuid) -> AppResult<String> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let expires = Utc::now() + chrono::Duration::days(30);
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(hash_refresh(&token))
        .bind(expires)
        .execute(db)
        .await?;
    // Muddati o'tgan tokenlarni tozalab turamiz (jadval o'smasligi uchun).
    let _ = sqlx::query("DELETE FROM refresh_tokens WHERE expires_at < now()")
        .execute(db)
        .await;
    Ok(token)
}

// ---------- Parol ----------

fn hash_password(password: &str) -> AppResult<String> {
    // password-hash 0.6 da tuz (salt) getrandom orqali avtomatik generatsiya qilinadi.
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|h| h.to_string())
        .map_err(|_| AppError::BadRequest("parolni hashlab bo'lmadi".into()))
}

/// Username: 3–20 belgi, faqat kichik harflar (a-z) va raqamlar. Bo'sh joy yo'q.
fn validate_username(username: &str) -> AppResult<()> {
    let len = username.chars().count();
    if !(3..=20).contains(&len) {
        return Err(AppError::BadRequest(
            "foydalanuvchi nomi 3–20 ta belgidan iborat bo'lsin".into(),
        ));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        return Err(AppError::BadRequest(
            "faqat kichik harflar (a-z) va raqamlar ishlatilsin".into(),
        ));
    }
    Ok(())
}

fn verify_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Login'da email enumeratsiyasini oldini olish uchun doimiy (dummy) hash.
/// Foydalanuvchi topilmaganda ham shu bilan tekshiruv qilinadi — javob vaqti bir xil bo'ladi.
fn dummy_hash() -> &'static str {
    use std::sync::OnceLock;
    static H: OnceLock<String> = OnceLock::new();
    // hash_password faqat OOM'da xato beradi — amalda hech qachon.
    H.get_or_init(|| hash_password("dummy-password-for-timing").unwrap_or_default())
}

// ---------- Extractor: himoyalangan route'lar uchun ----------

/// So'rovdan `Authorization: Bearer <token>` ni o'qib, foydalanuvchini aniqlaydi.
pub struct AuthUser {
    pub id: Uuid,
}

impl<S> FromRequestParts<S> for AuthUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app = AppState::from_ref(state);
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;

        let id = verify_access_token(&app.jwt_secret, token)?;
        Ok(AuthUser { id })
    }
}

// ---------- Router ----------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me).patch(update_me).delete(delete_me))
        .route("/auth/password", post(change_password))
}

/// Refresh token bilan yangi access token (va aylantirilgan refresh token) beradi.
async fn refresh(
    State(st): State<AppState>,
    Json(body): Json<RefreshBody>,
) -> AppResult<Json<RefreshResponse>> {
    let hash = hash_refresh(&body.refresh_token);
    // Tokenni topib, darhol o'chiramiz (rotation — bir marta ishlatiladi).
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "DELETE FROM refresh_tokens
          WHERE token_hash = $1 AND expires_at > now()
          RETURNING user_id",
    )
    .bind(&hash)
    .fetch_optional(&st.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let token = make_token(user_id, &st.jwt_secret)?;
    let refresh_token = issue_refresh(&st.db, user_id).await?;
    Ok(Json(RefreshResponse {
        token,
        refresh_token,
    }))
}

/// Refresh tokenni bekor qiladi (chiqish).
async fn logout(
    State(st): State<AppState>,
    Json(body): Json<RefreshBody>,
) -> AppResult<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM refresh_tokens WHERE token_hash = $1")
        .bind(hash_refresh(&body.refresh_token))
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn signup(
    State(st): State<AppState>,
    Json(body): Json<SignupBody>,
) -> AppResult<(StatusCode, Json<AuthResponse>)> {
    let username = body.username.trim().to_lowercase();
    let email = body.email.trim().to_lowercase();
    validate_username(&username)?;
    if !email.contains('@') {
        return Err(AppError::BadRequest("email noto'g'ri".into()));
    }
    validate::password(&body.password)?;

    let hash = hash_password(&body.password)?;

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (username, email, password_hash)
         VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(&username)
    .bind(&email)
    .bind(hash)
    .fetch_one(&st.db)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            // Qaysi maydon takrorlanganini indeks nomidan aniqlaymiz
            if db.constraint().is_some_and(|c| c.contains("username")) {
                AppError::BadRequest("bu foydalanuvchi nomi band".into())
            } else {
                AppError::BadRequest("bu email allaqachon ro'yxatdan o'tgan".into())
            }
        }
        other => AppError::Db(other),
    })?;

    let token = make_token(user.id, &st.jwt_secret)?;
    let refresh_token = issue_refresh(&st.db, user.id).await?;
    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            token,
            refresh_token,
            user: user.into(),
        }),
    ))
}

async fn login(
    State(st): State<AppState>,
    Json(body): Json<LoginBody>,
) -> AppResult<Json<AuthResponse>> {
    let email = body.email.trim().to_lowercase();
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&st.db)
        .await?;

    let user = match user {
        Some(u) if verify_password(&body.password, &u.password_hash) => u,
        Some(_) => return Err(AppError::BadRequest("email yoki parol noto'g'ri".into())),
        None => {
            // Foydalanuvchi topilmasa ham bir xil vaqt sarflaymiz (email enumeratsiyasiga qarshi).
            let _ = verify_password(&body.password, dummy_hash());
            return Err(AppError::BadRequest("email yoki parol noto'g'ri".into()));
        }
    };

    let token = make_token(user.id, &st.jwt_secret)?;
    let refresh_token = issue_refresh(&st.db, user.id).await?;
    Ok(Json(AuthResponse {
        token,
        refresh_token,
        user: user.into(),
    }))
}

async fn me(State(st): State<AppState>, user: AuthUser) -> AppResult<Json<PublicUser>> {
    let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_optional(&st.db)
        .await?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(u.into()))
}

/// Profilni yangilash (username va/yoki email)
async fn update_me(
    State(st): State<AppState>,
    user: AuthUser,
    Json(body): Json<UpdateProfile>,
) -> AppResult<Json<PublicUser>> {
    let username = match body.username {
        Some(u) => {
            let u = u.trim().to_lowercase();
            validate_username(&u)?;
            Some(u)
        }
        None => None,
    };
    let email = match body.email {
        Some(e) => {
            let e = e.trim().to_lowercase();
            if !e.contains('@') {
                return Err(AppError::BadRequest("email noto'g'ri".into()));
            }
            Some(e)
        }
        None => None,
    };

    let u = sqlx::query_as::<_, User>(
        "UPDATE users SET
            username = COALESCE($2, username),
            email    = COALESCE($3, email)
         WHERE id = $1
         RETURNING *",
    )
    .bind(user.id)
    .bind(username)
    .bind(email)
    .fetch_one(&st.db)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            if db.constraint().is_some_and(|c| c.contains("username")) {
                AppError::BadRequest("bu foydalanuvchi nomi band".into())
            } else {
                AppError::BadRequest("bu email allaqachon ro'yxatdan o'tgan".into())
            }
        }
        other => AppError::Db(other),
    })?;
    Ok(Json(u.into()))
}

/// Parolni o'zgartirish (joriy parolni tekshirib)
async fn change_password(
    State(st): State<AppState>,
    user: AuthUser,
    Json(body): Json<ChangePassword>,
) -> AppResult<Json<serde_json::Value>> {
    validate::password(&body.new_password)?;
    let u = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_optional(&st.db)
        .await?
        .ok_or(AppError::Unauthorized)?;

    if !verify_password(&body.current_password, &u.password_hash) {
        return Err(AppError::BadRequest("joriy parol noto'g'ri".into()));
    }

    let hash = hash_password(&body.new_password)?;
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(user.id)
        .bind(hash)
        .execute(&st.db)
        .await?;
    // Parol o'zgargach barcha refresh tokenlarni bekor qilamiz (eski sessiyalar tugaydi).
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
        .bind(user.id)
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Hisobni o'chirish (barcha vazifa/loyiha/odatlar ham o'chadi — ON DELETE CASCADE)
async fn delete_me(
    State(st): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user.id)
        .execute(&st.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_usernames_accepted() {
        assert!(validate_username("abc").is_ok());
        assert!(validate_username("user123").is_ok());
        assert!(validate_username("a1b2c3d4e5f6g7h8i9j0").is_ok()); // 20 belgi
    }

    #[test]
    fn too_short_or_long_rejected() {
        assert!(validate_username("ab").is_err());
        assert!(validate_username("a1b2c3d4e5f6g7h8i9j01").is_err()); // 21 belgi
    }

    #[test]
    fn invalid_chars_rejected() {
        assert!(validate_username("User").is_err()); // katta harf
        assert!(validate_username("user name").is_err()); // bo'sh joy
        assert!(validate_username("user_name").is_err()); // pastki chiziq
        assert!(validate_username("olma!").is_err()); // belgi
    }

    #[test]
    fn password_hash_verifies() {
        let hash = hash_password("maxfiy123").unwrap();
        assert!(verify_password("maxfiy123", &hash));
        assert!(!verify_password("noto'g'ri", &hash));
    }

    #[test]
    fn refresh_hash_is_stable_and_hex() {
        let h1 = hash_refresh("abc");
        let h2 = hash_refresh("abc");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // SHA-256 -> 32 bayt -> 64 hex
        assert!(h1.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(hash_refresh("abc"), hash_refresh("abd"));
    }

    #[test]
    fn jwt_roundtrip() {
        let secret = "test-secret";
        let id = Uuid::new_v4();
        let token = make_token(id, secret).unwrap();
        let data = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &Validation::default(),
        )
        .unwrap();
        assert_eq!(data.claims.sub, id.to_string());
    }
}
