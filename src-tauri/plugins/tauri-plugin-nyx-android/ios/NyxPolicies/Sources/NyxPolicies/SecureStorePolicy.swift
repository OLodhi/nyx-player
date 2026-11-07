import Foundation
import Security

/// What `secure_get` answers for a Keychain read.
public enum SecureReadOutcome: Equatable {
    case value(String)
    /// Really absent: JS gets `null` and doesn't retry
    case absent
    /// Present but unreadable: deleted, then answered as absent (as Android does)
    case corrupt
    /// Temporarily unavailable (e.g. before the first unlock): rejected, JS retries
    case failed(OSStatus)
}

/// What `secure_set` and `secure_delete` answer for a Keychain write or delete.
public enum SecureWriteOutcome: Equatable {
    case done
    case failed(OSStatus)
}

public func secureReadOutcome(status: OSStatus, data: Data?) -> SecureReadOutcome {
    switch status {
    case errSecSuccess:
        guard let data, let value = String(data: data, encoding: .utf8) else { return .corrupt }
        return .value(value)
    case errSecItemNotFound:
        return .absent
    default:
        return .failed(status)
    }
}

public func secureWriteOutcome(status: OSStatus) -> SecureWriteOutcome {
    status == errSecSuccess ? .done : .failed(status)
}

/// Deleting something that isn't there is a success.
public func secureDeleteOutcome(status: OSStatus) -> SecureWriteOutcome {
    status == errSecSuccess || status == errSecItemNotFound ? .done : .failed(status)
}

/// The reject message: the command and the status only, never a key or a value.
public func secureFailureMessage(_ command: String, status: OSStatus) -> String {
    "\(command) failed (OSStatus \(status))"
}
