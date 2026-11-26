import AppKit

final class ListnrHomeWindowController {
    private let shell: KernlAppShell
    var onRead: (() -> Void)?
    var onReadClipboard: (() -> Void)?
    var onClose: (() -> Void)?

    init() {
        shell = KernlAppShell(
            appName: "listnr",
            tagline: "read anything, anywhere",
            mark: .listnr,
            sections: ["Home", "Kernl", "Settings"],
            pageBuilder: { _ in NSView() }
        )
        shell.pageBuilder = { [weak self] index in
            guard let self else { return NSView() }
            switch index {
            case 1: return KernlPage()
            case 2: return self.settingsPage()
            default: return self.homePage()
            }
        }
        shell.onClose = { [weak self] in self?.onClose?() }
    }

    func show(section: Int = 0) { shell.show(section: section) }

    private func homePage() -> NSView {
        let reads = ReadStore.shared.entries
        let stats = KernlAppShell.statRow([
            ("Reads", "\(reads.count)", "desktop sessions"),
            ("Voice", "British", "system voice"),
            ("Shortcut", "⌥L", "selection or clipboard"),
            ("Chrome", "extension", "page reader")
        ])
        let quick = KernlCard(content: fleetVStack([
            fleetLabel("Quick actions", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetHStack([
                fleetButton("Read selection  ⌥L", primary: true, target: self, action: #selector(readSelection)),
                fleetButton("Read clipboard", target: self, action: #selector(readClipboard)),
                fleetButton("Chrome extension", target: self, action: #selector(openExtension))
            ], spacing: 8)
        ], spacing: 12))
        var recentViews: [NSView] = []
        if reads.isEmpty {
            recentViews.append(fleetLabel("Select text anywhere and press ⌥L.",
                                          size: 13, color: KernlTheme.muted, lines: 1))
        } else {
            for entry in reads.prefix(6) {
                let time = Self.dateFormatter.string(from: entry.date)
                let text = fleetLabel(entry.text.replacingOccurrences(of: "\n", with: " "),
                                      size: 13, color: KernlTheme.ink, lines: 2)
                recentViews.append(fleetVStack([
                    fleetLabel("\(time)  ·  \(entry.source)", size: 11, color: KernlTheme.muted, lines: 1),
                    text
                ], spacing: 3))
            }
        }
        let recent = KernlCard(content: fleetVStack([
            fleetLabel("Recent reads", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1)
        ] + recentViews, spacing: 12))
        return fleetVStack([
            KernlAppShell.pageHeader(eyebrow: "listnr", title: "Home",
                                    subtitle: "Read selected text in any app, or a page in Chrome."),
            stats, quick, recent
        ], spacing: 18)
    }

    private func settingsPage() -> NSView {
        let settings = KernlCard(content: fleetVStack([
            fleetLabel("Settings", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            appearanceRow(),
            fleetLabel("Applies to every app in the fleet.", size: 11, color: KernlTheme.muted, lines: 1),
            row("Voice", "System · British English"),
            row("Shortcut", "⌥L outside Chrome · Alt+L in Chrome"),
            row("Desktop", "Reads selected text or the clipboard"),
            row("Chrome", "Page player, highlighting and hosted voices")
        ], spacing: 12))
        let folders = KernlCard(content: fleetVStack([
            fleetLabel("Files", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetHStack([
                fleetButton("Kernl folder", target: self, action: #selector(openKernlFolder)),
                fleetButton("Chrome extension", target: self, action: #selector(openExtension)),
                fleetButton("Keys", target: self, action: #selector(openKeys))
            ], spacing: 8)
        ], spacing: 12))
        return fleetVStack([
            KernlAppShell.pageHeader(eyebrow: "listnr", title: "Settings",
                                    subtitle: "One reader for the laptop and one for the page."),
            settings, folders
        ], spacing: 18)
    }

    private func row(_ label: String, _ value: String) -> NSView {
        fleetHStack([
            fleetLabel(label, size: 13, color: KernlTheme.ink, lines: 1),
            fleetSpacer(),
            fleetLabel(value, size: 12, color: KernlTheme.muted, lines: 1)
        ], spacing: 10)
    }

    private func appearanceRow() -> NSView {
        let row = fleetHStack([], spacing: 6)
        for (index, title) in ["System", "Light", "Dark"].enumerated() {
            let button = fleetButton(title, target: self, action: #selector(appearanceTapped(_:)))
            button.tag = index
            row.addArrangedSubview(button)
        }
        return row
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "d MMM · HH:mm"; return f
    }()

    @objc private func readSelection() { onRead?() }
    @objc private func readClipboard() { onReadClipboard?() }
    @objc private func appearanceTapped(_ sender: NSButton) {
        KernlAppearance.set(["system", "light", "dark"][max(0, min(sender.tag, 2))])
    }
    @objc private func openKernlFolder() {
        NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fleet", isDirectory: true))
    }
    @objc private func openExtension() {
        let root = Bundle.main.bundleURL.deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        NSWorkspace.shared.open(root)
    }
    @objc private func openKeys() {
        NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fleet", isDirectory: true)
            .appendingPathComponent("fleet.env"))
    }
}
