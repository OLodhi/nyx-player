import Foundation
import NyxPolicies
import Security

/// A Keychain failure, carrying only the command and the OSStatus (never a key or a value).
struct SecureStoreError: Error {
    let command: String
    let status: OSStatus

    var message: String { secureFailureMessage(command, status: status) }
}

/// The plugin's secure store on iOS: one Keychain generic-password item per JS key, holding the
/// IPTV credentials and the Supabase session (design §5.5). Same answers as Android's SecureStore:
/// `nil` means really absent; a failure means temporarily unavailable, and JS retries.
/// Nothing is logged here: the values are credentials and tokens.
final class SecureStore {
    private static let service = "com.nyxplayer.app.secure"

    private func itemQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: SecureStore.service,
            kSecAttrAccount as String: key,
        ]
    }

    /// The stored value, or nil if absent. A corrupt item (not UTF-8) is deleted and reads as absent.
    func get(_ key: String) -> Result<String?, SecureStoreError> {
        var query = itemQuery(key)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch secureReadOutcome(status: status, data: item as? Data) {
        case .value(let value):
            return .success(value)
        case .absent:
            return .success(nil)
        case .corrupt:
            _ = SecItemDelete(itemQuery(key) as CFDictionary)
            return .success(nil)
        case .failed(let status):
            return .failure(SecureStoreError(command: "secure_get", status: status))
        }
    }

    /// Updates the item if present, otherwise adds it. Succeeds only once the Keychain has it.
    func set(_ key: String, _ value: String) -> Result<Void, SecureStoreError> {
        let data = Data(value.utf8)
        var status = SecItemUpdate(
            itemQuery(key) as CFDictionary,
            [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = itemQuery(key)
            item[kSecValueData as String] = data
            // Readable in the background after the first unlock; never copied to backups or other devices
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        switch secureWriteOutcome(status: status) {
        case .done:
            return .success(())
        case .failed(let status):
            return .failure(SecureStoreError(command: "secure_set", status: status))
        }
    }

    /// Removing an item that isn't there succeeds.
    func delete(_ key: String) -> Result<Void, SecureStoreError> {
        switch secureDeleteOutcome(status: SecItemDelete(itemQuery(key) as CFDictionary)) {
        case .done:
            return .success(())
        case .failed(let status):
            return .failure(SecureStoreError(command: "secure_delete", status: status))
        }
    }
}
