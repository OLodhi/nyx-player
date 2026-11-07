//! iOS: the root certificates mpv's TLS checks streams against. MPVKit's FFmpeg uses GnuTLS, which
//! can't read the iOS trust store, and iOS can't export it. So the plugin ships Mozilla's list
//! (webpki-root-certs, CDLA-Permissive-2.0) and the Swift side writes it as a PEM file
//! (ios/Sources/NyxIosPlugin/CaBundle.swift, through ios/Sources/NyxRustExports/nyx_rust_exports.h).

/// Number of root certificates.
#[no_mangle]
pub extern "C" fn nyx_ios_root_cert_count() -> usize {
    webpki_root_certs::TLS_SERVER_ROOT_CERTS.len()
}

/// DER bytes of root certificate `index` (static, never freed), with their length written to
/// `len`. Null, with `len` untouched, when `index` is out of range or `len` is null.
///
/// # Safety
/// `len` must be null or point to memory writable as one `usize`.
#[no_mangle]
pub unsafe extern "C" fn nyx_ios_root_cert(index: usize, len: *mut usize) -> *const u8 {
    match webpki_root_certs::TLS_SERVER_ROOT_CERTS.get(index) {
        Some(cert) if !len.is_null() => {
            let der: &[u8] = cert.as_ref();
            *len = der.len();
            der.as_ptr()
        }
        _ => std::ptr::null(),
    }
}
