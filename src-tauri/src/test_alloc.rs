//! Compteur de mémoire des tests (jamais dans l'app) : mesure le plus haut niveau de mémoire prise
//! par le fil du test pendant un appel, pour prouver qu'une lecture ne construit pas un gros vecteur.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

struct Counting;

#[global_allocator]
static ALLOCATOR: Counting = Counting;

thread_local! {
    // Initialisation constante et sans destructeur : utilisable depuis l'allocateur
    static LIVE: Cell<isize> = const { Cell::new(0) };
    static PEAK: Cell<isize> = const { Cell::new(0) };
}

fn track(delta: isize) {
    let _ = LIVE.try_with(|live| {
        let now = live.get() + delta;
        live.set(now);
        let _ = PEAK.try_with(|peak| peak.set(peak.get().max(now)));
    });
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let p = System.alloc(layout);
        if !p.is_null() {
            track(layout.size() as isize);
        }
        p
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let p = System.alloc_zeroed(layout);
        if !p.is_null() {
            track(layout.size() as isize);
        }
        p
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
        track(-(layout.size() as isize));
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let p = System.realloc(ptr, layout, new_size);
        if !p.is_null() {
            track(new_size as isize - layout.size() as isize);
        }
        p
    }
}

/// Résultat de `f` et le plus haut niveau de mémoire (en octets) pris en plus par ce fil pendant
/// son exécution.
pub fn peak_during<R>(f: impl FnOnce() -> R) -> (R, usize) {
    LIVE.with(|live| live.set(0));
    PEAK.with(|peak| peak.set(0));
    let result = f();
    let peak = PEAK.with(Cell::get);
    (result, peak.max(0) as usize)
}
