import Foundation
import XCTest
@testable import NyxPolicies

/// `network_status` asked right after launch, before the monitor's first reading, must wait for
/// that reading (up to a timeout) rather than report "not connected".
final class FirstValueTests: XCTestCase {
    private let queue = DispatchQueue(label: "FirstValueTests")

    func testReturnsImmediatelyWhenPublished() {
        let first = FirstValue<Int>()
        first.publish(1)
        let done = expectation(description: "value")
        first.get(timeout: 1, queue: queue) { value in
            XCTAssertEqual(value, 1)
            done.fulfill()
        }
        wait(for: [done], timeout: 0.5)
    }

    func testWaitsForFirstPublish() {
        let first = FirstValue<Int>()
        let done = expectation(description: "value")
        first.get(timeout: 1, queue: queue) { value in
            XCTAssertEqual(value, 2)
            done.fulfill()
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) { first.publish(2) }
        wait(for: [done], timeout: 2)
    }

    func testTimesOutWithNil() {
        let first = FirstValue<Int>()
        let done = expectation(description: "nil")
        first.get(timeout: 0.2, queue: queue) { value in
            XCTAssertNil(value)
            done.fulfill()
        }
        wait(for: [done], timeout: 2)
    }

    /// Published twice, then the timeout passes: still exactly one callback.
    func testCallsBackOnce() {
        let first = FirstValue<Int>()
        let lock = NSLock()
        var calls = 0
        first.get(timeout: 0.3, queue: queue) { _ in
            lock.lock()
            calls += 1
            lock.unlock()
        }
        first.publish(1)
        first.publish(2)
        let settled = expectation(description: "settled")
        queue.asyncAfter(deadline: .now() + 0.6) { settled.fulfill() }
        wait(for: [settled], timeout: 2)
        lock.lock()
        XCTAssertEqual(calls, 1)
        lock.unlock()
    }
}
