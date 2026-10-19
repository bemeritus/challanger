//! Guruh ichidagi real-vaqt yangilanishlari uchun yengil "hub".
//!
//! Har bir guruhga bitta [`tokio::sync::broadcast`] kanali to'g'ri keladi.
//! Mutatsiya qiluvchi handlerlar (masalan, yangi chat xabari) [`Hub::publish`]
//! chaqiradi; SSE endpoint esa [`Hub::subscribe`] orqali ulanib, o'sha guruhga
//! ulangan brauzerlarga signal yuboradi. Signal — kichik JSON (`{"kind":"..."}`);
//! frontend uni olgach guruh detalini qayta yuklaydi.
//!
//! Holat xotirada saqlanadi — bitta instansli deploy (Docker Compose, VPS) uchun
//! yetarli. Bir nechta instansga kengaytirilsa, bu qatlamni Redis pub/sub kabi
//! tashqi broker bilan almashtirish kerak bo'ladi.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::broadcast;
use uuid::Uuid;

/// Guruh -> broadcast kanali registri. `Clone` arzon (faqat `Arc` nusxasi).
#[derive(Clone, Default)]
pub struct Hub {
    channels: Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>,
}

impl Hub {
    pub fn new() -> Self {
        Self::default()
    }

    /// Guruh kanaliga obuna bo'ladi (kanal bo'lmasa — yaratadi).
    pub fn subscribe(&self, group: Uuid) -> broadcast::Receiver<String> {
        let mut map = self.channels.lock().expect("hub mutex");
        map.entry(group)
            .or_insert_with(|| broadcast::channel(64).0)
            .subscribe()
    }

    /// Guruhga ulangan barcha tinglovchilarga signal yuboradi. Hech kim
    /// tinglamayotgan bo'lsa — kanalni registrdan olib tashlaydi (xotira
    /// o'smasligi uchun).
    pub fn publish(&self, group: Uuid, event: impl Into<String>) {
        let mut map = self.channels.lock().expect("hub mutex");
        if let Some(tx) = map.get(&group) {
            // `send` faqat tinglovchi qolmaganda `Err` qaytaradi.
            if tx.send(event.into()).is_err() {
                map.remove(&group);
            }
        }
    }
}
