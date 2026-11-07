import Foundation

/// The latest value of something that arrives asynchronously (the network path), with a way to
/// wait, up to a timeout, for the first one. Thread-safe.
public final class FirstValue<T> {
    private let lock = NSLock()
    private var value: T?
    private var waiters: [(id: UInt64, queue: DispatchQueue, completion: (T?) -> Void)] = []
    private var nextId: UInt64 = 0

    public init() {}

    /// Stores the latest value and answers everyone waiting for the first one.
    public func publish(_ value: T) {
        lock.lock()
        self.value = value
        let waiting = waiters
        waiters.removeAll()
        lock.unlock()
        for waiter in waiting {
            waiter.queue.async { waiter.completion(value) }
        }
    }

    /// Calls back once on `queue`: with the latest value if there is one, otherwise with the first
    /// one published within `timeout`, otherwise with nil.
    public func get(timeout: TimeInterval, queue: DispatchQueue, _ completion: @escaping (T?) -> Void) {
        lock.lock()
        if let value {
            lock.unlock()
            queue.async { completion(value) }
            return
        }
        let id = nextId
        nextId += 1
        waiters.append((id: id, queue: queue, completion: completion))
        lock.unlock()

        // Strong capture: the timeout must fire even if the caller has dropped its reference
        queue.asyncAfter(deadline: .now() + timeout) { [self] in
            self.lock.lock()
            let index = self.waiters.firstIndex { $0.id == id }
            if let index { self.waiters.remove(at: index) }
            self.lock.unlock()
            // Still waiting at the deadline: answered by publish otherwise, never twice
            if index != nil { completion(nil) }
        }
    }
}
