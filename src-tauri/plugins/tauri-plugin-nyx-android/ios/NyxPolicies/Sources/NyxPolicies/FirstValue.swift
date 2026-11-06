import Foundation

/// The latest value of something that arrives asynchronously (the network path), with a way to
/// wait, up to a timeout, for the first one.
public final class FirstValue<T> {
    public init() {}

    public func publish(_ value: T) {
        // not implemented yet
    }

    public func get(timeout: TimeInterval, queue: DispatchQueue, _ completion: @escaping (T?) -> Void) {
        queue.async { completion(nil) } // not implemented yet
    }
}
