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
            sections: ["Home", "Settings"],
            pageBuilder: { _ in NSView() }
        )
        shell.pageBuilder = { [weak self] index in
            guard let self else { return NSView() }
            switch index {
            case 1: return self.settingsPage()
            default: return self.homePage()
            }
        }
        shell.onClose = { [weak self] in self?.onClose?() }
        ListnrVoiceCatalog.shared.refresh { [weak self] in
            guard let self, self.shell.window?.isVisible == true else { return }
            self.shell.reloadCurrent()
        }
    }

    func show(section: Int = 0) { shell.show(section: section) }
    func showSettings() {
        shell.show(section: 1)
        ListnrVoiceCatalog.shared.refresh { [weak self] in
            guard let self, self.shell.window?.isVisible == true else { return }
            self.shell.reloadCurrent()
        }
    }

    private func homePage() -> NSView {
        let reads = ReadStore.shared.entries
        let stats = KernlAppShell.statRow([
            ("Reads", "\(reads.count)", "desktop sessions"),
            ("Voice", ListnrVoiceCatalog.shared.currentVoice()?.name ?? "Heart", "same as Chrome"),
            ("Shortcut", "⌥L", "selection or clipboard"),
            ("Chrome", "extension", "page reader")
        ])
        let quick = KernlCard(content: fleetVStack([
            fleetLabel("Quick actions", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetHStack([
                fleetButton("Read selection  ⌥L", primary: true, target: self, action: #selector(readSelection)),
                fleetButton("Read clipboard", target: self, action: #selector(readClipboard)),
                fleetButton("Chrome extension", target: self, action: #selector(openExtension)),
                fleetButton("Settings", target: self, action: #selector(openSettings))
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
            voiceCard(), settings, folders
        ], spacing: 18)
    }

    private func voiceCard() -> NSView {
        let catalog = ListnrVoiceCatalog.shared
        let current = ListnrPreferences.shared.voiceID
        let popup = NSPopUpButton(frame: .zero, pullsDown: false)
        popup.translatesAutoresizingMaskIntoConstraints = false
        popup.font = Type.sans(12)
        popup.controlSize = .large
        for voice in catalog.voices {
            popup.addItem(withTitle: "\(voice.name)  ·  \(voice.displayNote)")
            popup.lastItem?.representedObject = voice.id
        }
        if let index = catalog.voices.firstIndex(where: { $0.id == current }) {
            popup.selectItem(at: index)
        }
        popup.target = self
        popup.action = #selector(voiceChanged(_:))
        popup.widthAnchor.constraint(equalToConstant: 340).isActive = true
        let status = catalog.online
            ? "\(catalog.providerLabel) · same server as Chrome"
            : "Server offline · using the macOS US female voice"
        return KernlCard(content: fleetVStack([
            fleetLabel("Voice", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetLabel("Heart is the default US female voice. Changing this changes desktop reads and uses the same server as Chrome.",
                       size: 11, color: KernlTheme.muted, lines: 2),
            popup,
            fleetLabel(status, size: 11, color: KernlTheme.muted, lines: 1)
        ], spacing: 10))
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

    @objc private func openSettings() { shell.show(section: 1) }
    @objc private func voiceChanged(_ sender: NSPopUpButton) {
        guard let id = sender.selectedItem?.representedObject as? String else { return }
        ListnrPreferences.shared.voiceID = id
        shell.show(section: 1)
    }
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
