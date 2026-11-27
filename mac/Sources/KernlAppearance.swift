import AppKit

/// One appearance switch for the whole fleet. The file is plain text so every
/// process, including the Listnr server, can read it without a shared framework.
enum KernlAppearance {
    static let notification = Notification.Name("com.archit.loom.appearance")
    static let allowed = ["system", "light", "dark"]

    static var file: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fleet", isDirectory: true)
            .appendingPathComponent("appearance")
    }

    static func value() -> String {
        if let text = try? String(contentsOf: file, encoding: .utf8) {
            let clean = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if allowed.contains(clean) { return clean }
        }
        if let legacy = UserDefaults.standard.string(forKey: "loom.appearance"),
           allowed.contains(legacy) {
            return legacy
        }
        return "system"
    }

    static func set(_ value: String) {
        let clean = allowed.contains(value) ? value : "system"
        guard clean != self.value() else { return }
        let fm = FileManager.default
        try? fm.createDirectory(at: file.deletingLastPathComponent(),
                                withIntermediateDirectories: true,
                                attributes: [.posixPermissions: 0o700])
        try? (clean + "\n").write(to: file, atomically: true, encoding: .utf8)
        try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        UserDefaults.standard.set(clean, forKey: "loom.appearance")
        broadcast()
    }

    static func apply(_ value: String? = nil) {
        Type.scale = textScale()
        switch value ?? self.value() {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: NSApp.appearance = nil
        }
    }

    private static var lastSeen = ""
    private static var lastScale: CGFloat = 1

    /// Posted in this app when the shared text size changes, so open windows rebuild.
    static let textScaleChanged = Notification.Name("KernlTextScaleChanged")

    private static func noticeScale() {
        let scale = textScale()
        guard scale != lastScale else { return }
        lastScale = scale
        Type.scale = scale
        NotificationCenter.default.post(name: textScaleChanged, object: nil)
    }

    static func broadcast() {
        DistributedNotificationCenter.default().postNotificationName(notification, object: nil,
                                                                     userInfo: nil, deliverImmediately: true)
    }

    // MARK: Text size

    /// One text size for every app, like the appearance: ~/.fleet/textsize.
    static let scales: [CGFloat] = [0.85, 0.92, 1, 1.08, 1.16, 1.25]

    static var scaleFile: URL { file.deletingLastPathComponent().appendingPathComponent("textsize") }

    static func textScale() -> CGFloat {
        guard let text = try? String(contentsOf: scaleFile, encoding: .utf8),
              let value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return 1 }
        return scales.min(by: { abs($0 - CGFloat(value)) < abs($1 - CGFloat(value)) }) ?? 1
    }

    static func setTextScale(_ scale: CGFloat) {
        try? FileManager.default.createDirectory(at: scaleFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? String(format: "%.2f\n", Double(scale)).write(to: scaleFile, atomically: true, encoding: .utf8)
        noticeScale()
        broadcast()
    }

    /// Steps the shared text size: +1 bigger, -1 smaller, 0 back to normal.
    static func stepTextSize(_ direction: Int) {
        let current = scales.firstIndex(of: textScale()) ?? 2
        let next = direction == 0 ? 2 : max(0, min(scales.count - 1, current + direction))
        setTextScale(scales[next])
    }

    private static var keyMonitor: Any?

    /// Command plus, minus and zero change the text size in this app's windows,
    /// and every other app follows.
    static func installTextSizeKeys() {
        Type.scale = textScale()
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.shift, .numericPad]) == .command,
                  let window = event.window, !(window is NSPanel) else { return event }
            switch event.charactersIgnoringModifiers {
            case "=", "+": stepTextSize(1); return nil
            case "-", "_": stepTextSize(-1); return nil
            case "0": stepTextSize(0); return nil
            default: return event
            }
        }
    }

    @discardableResult
    static func observe(_ handler: @escaping () -> Void) -> NSObjectProtocol {
        lastSeen = value()
        lastScale = textScale()
        let center = DistributedNotificationCenter.default()
        let token = center.addObserver(forName: notification, object: nil, queue: .main) { _ in
            lastSeen = value()
            noticeScale()
            handler()
        }
        // The sender posts with deliverImmediately so background menu-bar apps
        // are not left waiting; the one second file check is a backstop.
        let timer = Timer(timeInterval: 1.0, repeats: true) { _ in
            let current = value()
            let scale = textScale()
            guard current != lastSeen || scale != lastScale else { return }
            lastSeen = current
            noticeScale()
            handler()
        }
        RunLoop.main.add(timer, forMode: .common)
        return token
    }
}
