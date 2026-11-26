import Foundation
import AppKit
import ApplicationServices

enum SelectionReader {
    static func selectedText() -> String? {
        guard AXIsProcessTrusted() else { return nil }
        guard let element = focusedElement() else { return nil }
        return stringAttribute(element, kAXSelectedTextAttribute)
    }

    /// If nothing is highlighted, read the most substantial text around the
    /// focused element/window. This keeps Option+L useful on a page, a Kindle
    /// book or any app where selecting first is friction.
    static func fallbackText() -> String? {
        guard AXIsProcessTrusted() else { return nil }
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)

        if let focused = focusedElement() ?? focusedElement(appElement: appElement) {
            for attribute in [kAXValueAttribute, kAXSelectedTextAttribute] {
                if let text = stringAttribute(focused, attribute), isUseful(text) {
                    return trim(text)
                }
            }
        }

        guard let window = focusedWindow(appElement: appElement) else { return nil }
        var seen = Set<String>()
        var texts: [String] = []
        collectText(from: window, depth: 0, seen: &seen, into: &texts)

        let useful = texts
            .map(trim)
            .filter { isUseful($0) }
        guard !useful.isEmpty else { return nil }

        // Prefer the longest block (the article/body), then add a few nearby
        // blocks for context. Never send the whole UI tree.
        let sorted = useful.sorted { $0.count > $1.count }
        if let longest = sorted.first, longest.count >= 60 {
            return String(longest.prefix(12_000))
        }
        return String(sorted.prefix(8).joined(separator: "\n").prefix(12_000))
    }

    private static func focusedElement() -> AXUIElement? {
        let system = AXUIElementCreateSystemWide()
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let focused else { return nil }
        return (focused as! AXUIElement)
    }

    private static func focusedElement(appElement: AXUIElement) -> AXUIElement? {
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let focused else { return nil }
        return (focused as! AXUIElement)
    }

    private static func focusedWindow(appElement: AXUIElement) -> AXUIElement? {
        var window: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &window) == .success,
              let window else { return nil }
        return (window as! AXUIElement)
    }

    private static func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private static func collectText(from element: AXUIElement,
                                    depth: Int,
                                    seen: inout Set<String>,
                                    into texts: inout [String]) {
        guard depth < 9, texts.count < 120 else { return }
        if let value = stringAttribute(element, kAXValueAttribute), !value.isEmpty {
            let key = trim(value)
            if seen.insert(key).inserted { texts.append(value) }
        }
        if let title = stringAttribute(element, kAXTitleAttribute), !title.isEmpty {
            let key = trim(title)
            if seen.insert(key).inserted { texts.append(title) }
        }
        var childrenValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenValue) == .success,
              let children = childrenValue as? [AXUIElement] else { return }
        for child in children.prefix(80) {
            collectText(from: child, depth: depth + 1, seen: &seen, into: &texts)
        }
    }

    private static func trim(_ text: String) -> String {
        text.replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\t", with: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isUseful(_ text: String) -> Bool {
        let clean = trim(text)
        guard clean.count >= 20 else { return false }
        let lower = clean.lowercased()
        let junk = ["search", "menu", "settings", "sign in", "log in", "back", "forward",
                    "close", "minimize", "zoom", "toolbar", "address bar", "tab", "window"]
        if junk.contains(lower) { return false }
        let letters = clean.filter { $0.isLetter }.count
        return letters >= max(12, clean.count / 3)
    }
}
