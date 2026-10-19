use std::sync::Arc;

use axum::Router;
use axum::routing::get;
use sqlx::postgres::PgPoolOptions;
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::SmartIpKeyExtractor;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use challanger::telegram::TelegramBot;
use challanger::{AppState, auth, push, realtime, reminders, routes};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "challanger=debug,tower_http=info,info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL o'rnatilishi kerak (.env yoki nix devShell)");
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".into());

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Migratsiyalarni ishga tushirish
    sqlx::migrate!("./migrations").run(&db).await?;

    // JWT maxfiy kaliti — MAJBURIY. O'rnatilmasa ochiq kodli fallback bilan
    // ishga tushirish auth bypass'ga olib keladi, shuning uchun release'da panic.
    let jwt_secret = match std::env::var("JWT_SECRET") {
        Ok(s) if s.trim().len() >= 16 => s,
        Ok(_) => {
            if cfg!(debug_assertions) {
                tracing::warn!("JWT_SECRET juda qisqa — dev fallback ishlatilyapti");
                "dev-secret-o'zgartiring-productionda".into()
            } else {
                panic!("JWT_SECRET kamida 16 ta belgidan iborat bo'lishi kerak");
            }
        }
        Err(_) => {
            if cfg!(debug_assertions) {
                tracing::warn!(
                    "JWT_SECRET o'rnatilmagan — dev fallback ishlatilyapti (PRODUCTIONDA XATO)"
                );
                "dev-secret-o'zgartiring-productionda".into()
            } else {
                panic!("JWT_SECRET o'rnatilishi shart (production)");
            }
        }
    };

    // Telegram bot (ixtiyoriy) — TELEGRAM_BOT_TOKEN berilganda yoqiladi.
    let telegram = match TelegramBot::from_env(db.clone()).await {
        Some(bot) => {
            tracing::info!("🤖 Telegram bot yoqildi: @{}", bot.username());
            tokio::spawn(bot.clone().run_polling());
            tokio::spawn(bot.clone().run_reminders());
            tokio::spawn(bot.clone().run_digest());
            Some(bot)
        }
        None => {
            tracing::info!("Telegram bot o'chirilgan (TELEGRAM_BOT_TOKEN yo'q yoki yaroqsiz)");
            None
        }
    };

    // Web Push (ixtiyoriy) — VAPID_PRIVATE_KEY berilganda yoqiladi.
    let push = push::WebPush::from_env();
    match &push {
        Some(_) => tracing::info!("🔔 Web Push yoqildi (VAPID)"),
        None => tracing::info!("Web Push o'chirilgan (VAPID_PRIVATE_KEY yo'q)"),
    }

    // Shaxsiy eslatma dispatcheri (Telegram + Web Push) — kamida bitta kanal bo'lsa.
    if telegram.is_some() || push.is_some() {
        tokio::spawn(reminders::run(db.clone(), telegram.clone(), push.clone()));
    }

    let features = challanger::features::load(&db).await;
    let state = AppState {
        db,
        jwt_secret: Arc::new(jwt_secret),
        telegram,
        push,
        hub: realtime::Hub::new(),
        features,
    };

    // CORS: CORS_ALLOWED_ORIGINS (vergul bilan) berilsa — faqat o'shalar; aks holda
    // barcha originlarga ochiq (dev qulayligi uchun). Prodda ro'yxat berish tavsiya etiladi.
    let cors = match std::env::var("CORS_ALLOWED_ORIGINS") {
        Ok(v) if !v.trim().is_empty() => {
            let origins: Vec<axum::http::HeaderValue> =
                v.split(',').filter_map(|s| s.trim().parse().ok()).collect();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
        }
        _ => {
            if !cfg!(debug_assertions) {
                tracing::warn!(
                    "CORS_ALLOWED_ORIGINS o'rnatilmagan — barcha originlarga ochiq (prodda cheklang)"
                );
            }
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
        }
    };

    // Auth endpoint'lariga rate limiting — brute-force himoyasi.
    // IP kaliti X-Forwarded-For / X-Real-IP orqali (reverse-proxy ortida ham).
    // Burst 10 ta so'rov, so'ng sekundiga 1 ta to'ldiriladi.
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(1)
            .burst_size(10)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("governor konfiguratsiyasi"),
    );
    let auth_routes = auth::router().layer(GovernorLayer::new(governor_conf));

    // Umumiy rate limit — barcha API endpointlari uchun (abuse/spam himoyasi).
    // Auth route'lar ustiga yana strictroq limit ham qo'shiladi.
    let general_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(5)
            .burst_size(120)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("umumiy governor konfiguratsiyasi"),
    );

    let api = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(auth_routes)
        .merge(routes::projects::router())
        .merge(routes::tasks::router())
        .merge(routes::calendar::router())
        .merge(routes::habits::router())
        .merge(routes::pomodoro::router())
        .merge(routes::groups::router())
        .merge(routes::subtasks::router())
        .merge(routes::telegram::router())
        .merge(push::router())
        .merge(challanger::features::router())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            challanger::features::feature_gate,
        ))
        .layer(GovernorLayer::new(general_conf));

    // Qurilgan frontend'ni (Vite `dist`) shu serverdan beramiz.
    // SPA bo'lgani uchun topilmagan yo'llar `index.html`ga yo'naltiriladi.
    // Dev'da bu papka bo'lmasligi mumkin — u holda oddiygina 404 qaytadi (Vite proxy ishlatiladi).
    let frontend_dir = std::env::var("FRONTEND_DIR").unwrap_or_else(|_| "frontend/dist".into());
    let index_html = format!("{frontend_dir}/index.html");
    let static_service = ServeDir::new(&frontend_dir).not_found_service(ServeFile::new(index_html));

    let app = Router::new()
        .nest("/api", api)
        .fallback_service(static_service)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("🚀 Server ishga tushdi: http://{bind_addr}");
    // ConnectInfo — rate limiter IP kalitini olishi uchun kerak.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
