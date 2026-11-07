import Foundation
import NyxPolicies
import NyxRustExports

/// The CA list mpv's TLS checks https streams against (`tls-ca-file`). MPVKit's FFmpeg uses GnuTLS,
/// which can't read the iOS trust store, and iOS can't export it, so the plugin ships Mozilla's
/// list (Rust: src/ios_ca.rs, webpki-root-certs) and writes it here as one PEM file, like
/// Android's SystemCaBundle. No file means https streams are refused with TLS_CA_UNAVAILABLE.
enum CaBundle {
    static let fileName = "nyx-cacert.pem"
    static let temporaryFileName = "nyx-cacert.pem.tmp"

    /// Writes the PEM (a temporary file, then a replace, so mpv never reads half a file) and
    /// returns its URL, or nil if it can't be written. Call it off the main thread.
    static func prepare(cacheDirectory: URL) -> URL? {
        let count = nyx_ios_root_cert_count()
        var certificates: [Data] = []
        certificates.reserveCapacity(count)
        for index in 0..<count {
            var length = 0
            guard let bytes = nyx_ios_root_cert(index, &length), length > 0 else { continue }
            certificates.append(Data(bytes: bytes, count: length))
        }
        guard !certificates.isEmpty else { return nil }

        let target = cacheDirectory.appendingPathComponent(fileName)
        let temporary = cacheDirectory.appendingPathComponent(temporaryFileName)
        let files = FileManager.default
        do {
            try files.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
            try Data(PemBundle.pem(fromDER: certificates).utf8).write(to: temporary)
            if files.fileExists(atPath: target.path) {
                _ = try files.replaceItemAt(target, withItemAt: temporary)
            } else {
                try files.moveItem(at: temporary, to: target)
            }
            return target
        } catch {
            try? files.removeItem(at: temporary)
            return nil
        }
    }
}
