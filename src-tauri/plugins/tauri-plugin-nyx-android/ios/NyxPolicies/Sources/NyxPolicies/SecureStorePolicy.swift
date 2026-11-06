import Foundation
import Security

/// What `secure_get` answers for a Keychain read.
public enum SecureReadOutcome: Equatable {
    case value(String)
    case absent
    case corrupt
    case failed(OSStatus)
}

/// What `secure_set` and `secure_delete` answer for a Keychain write or delete.
public enum SecureWriteOutcome: Equatable {
    case done
    case failed(OSStatus)
}

public func secureReadOutcome(status: OSStatus, data: Data?) -> SecureReadOutcome {
    .absent // not implemented yet
}

public func secureWriteOutcome(status: OSStatus) -> SecureWriteOutcome {
    .done // not implemented yet
}

public func secureDeleteOutcome(status: OSStatus) -> SecureWriteOutcome {
    .done // not implemented yet
}

public func secureFailureMessage(_ command: String, status: OSStatus) -> String {
    "" // not implemented yet
}
