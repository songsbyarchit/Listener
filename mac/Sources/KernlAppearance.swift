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
        DistributedNotificationCenter.default().post(name: notification, object: nil)
    }

    static func apply(_ value: String? = nil) {
        switch value ?? self.value() {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: NSApp.appearance = nil
        }
    }

    @discardableResult
    static func observe(_ handler: @escaping () -> Void) -> NSObjectProtocol {
        DistributedNotificationCenter.default().addObserver(
            forName: notification, object: nil, queue: .main
        ) { _ in handler() }
    }
}
