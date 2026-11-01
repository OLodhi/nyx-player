//! Heavy database writers in progress (catalogue ingestion, guide sync, guide remap).
//!
//! The background catalogue refresh (`catalog_refresh.rs`) writes in short transactions and gives
//! way to them: it checks `heavy_write_in_progress()` before starting, while downloading and
//! between two batches, and stops with the status `busy` (retried later). The heavy writers are
//! never slowed down or blocked by it: they only raise a counter. Between themselves, the heavy
//! writers take turns for their database writes (`exclusive_write`).

use std::sync::atomic::{AtomicUsize, Ordering};

static HEAVY_WRITERS: AtomicUsize = AtomicUsize::new(0);

/// Held for the whole duration of a heavy write command; released on drop, even on error.
pub struct HeavyWriteGuard(());

impl HeavyWriteGuard {
    pub fn new() -> Self {
        HEAVY_WRITERS.fetch_add(1, Ordering::SeqCst);
        HeavyWriteGuard(())
    }
}

impl Drop for HeavyWriteGuard {
    fn drop(&mut self) {
        HEAVY_WRITERS.fetch_sub(1, Ordering::SeqCst);
    }
}

pub fn heavy_write_in_progress() -> bool {
    HEAVY_WRITERS.load(Ordering::SeqCst) > 0
}

/// Turn-taking between the heavy writers that touch the same tables: the catalogue
/// write at login (clears and rewrites the channels), the guide write and the channel ↔ guide
/// remap (both rewrite `live.matched_epg_id`). Nothing used to stop them writing together: one
/// could fail on "database is locked" or wipe the links of the other. Only the write part is held
/// (never a download); waiters are served in arrival order.
static EXCLUSIVE_WRITE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Waits for its turn and keeps it until dropped, even on error.
pub async fn exclusive_write() -> tokio::sync::MutexGuard<'static, ()> {
    EXCLUSIVE_WRITE.lock().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn heavy_writes_take_turns() {
        // Heavy writes started together no longer overlap
        let active = std::sync::Arc::new(AtomicUsize::new(0));
        let overlap = std::sync::Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let active = active.clone();
            let overlap = overlap.clone();
            tasks.push(tokio::spawn(async move {
                let _turn = exclusive_write().await;
                if active.fetch_add(1, Ordering::SeqCst) > 0 {
                    overlap.fetch_add(1, Ordering::SeqCst);
                }
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                active.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        assert_eq!(overlap.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn guard_raises_and_releases_the_flag() {
        // Other tests may hold a guard at the same time: compare with the value seen before
        let before = HEAVY_WRITERS.load(Ordering::SeqCst);
        {
            let _a = HeavyWriteGuard::new();
            let _b = HeavyWriteGuard::new();
            assert!(heavy_write_in_progress());
            assert!(HEAVY_WRITERS.load(Ordering::SeqCst) >= before + 2);
        }
        assert!(HEAVY_WRITERS.load(Ordering::SeqCst) <= before + 2);
    }
}
