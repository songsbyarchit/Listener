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
            ("Shortcut", "⌥L", "selection or screen"),
            ("Chrome", "extension", "page reader")
        ], onSelect: { [weak self] index in self?.openTile(index) })
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
        shell.reloadCurrent()
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
    /// The unpacked extension folder for chrome://extensions → Load unpacked.
    static var extensionFolder: URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let fromBuild = Bundle.main.bundleURL.deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        return [fromBuild, home.appendingPathComponent("Downloads/Listener")]
            .first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("manifest.json").path) }
    }

    static var extensionVersion: String {
        guard let folder = extensionFolder,
              let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = json["version"] as? String else { return "Unknown" }
        return version
    }

    @objc private func openExtension() {
        if let folder = Self.extensionFolder { NSWorkspace.shared.open(folder) }
    }

    // MARK: Tile detail pages

    private func openTile(_ index: Int) {
        switch index {
        case 0: readsDetail()
        case 1: voiceDetail()
        case 2: shortcutDetail()
        default: chromeDetail()
        }
    }

    private func readsDetail() {
        let reads = ReadStore.shared.entries
        let week = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        let bySource = Dictionary(grouping: reads, by: { $0.source }).map { ($0.key, $0.value.count) }.sorted { $0.1 > $1.1 }
        let characters = reads.reduce(0) { $0 + $1.text.count }
        var facts: [(String, String)] = [
            ("All reads", "\(reads.count)"),
            ("Last 7 days", "\(reads.filter { $0.date >= week }.count)"),
            ("Tab switches saved", "\(reads.count), about \(Int((Double(reads.count) * 20 / 60).rounded())) min at 20 s each"),
            ("Read aloud", "\(characters) characters, about \(max(0, characters / 900)) minutes")
        ]
        if !bySource.isEmpty {
            facts.append(("By source", bySource.map { "\($0.0) \($0.1)" }.joined(separator: ", ")))
        }
        let entries = reads.prefix(12).map { entry in
            (meta: [KernlAppShell.shortDate(entry.date), entry.source, entry.voice ?? ""].filter { !$0.isEmpty }.joined(separator: ", "),
             text: entry.text.replacingOccurrences(of: "\n", with: " "))
        }
        shell.showDetail(title: "Reads", subtitle: "Everything listnr has read aloud on this Mac, newest first.", body: [
            KernlAppShell.factCard("Summary", facts),
            KernlAppShell.entryCard("Recent reads", Array(entries), empty: "Select text anywhere and press ⌥L.")
        ])
    }

    private func voiceDetail() {
        let current = ListnrVoiceCatalog.shared.currentVoice()
        let change = fleetButton("Change voice", primary: true, target: self, action: #selector(openSettingsFromDetail))
        shell.showDetail(title: "Voice", subtitle: "The voice listnr reads with, shared with the Chrome reader.", body: [
            KernlAppShell.factCard("Current voice", [
                ("Voice", current?.name ?? "Heart"),
                ("Server", "Local Kokoro at 127.0.0.1:8787, the same one Chrome uses"),
                ("Cost", "Free. Nothing leaves this Mac"),
                ("If the server is off", "listnr falls back to a US English macOS voice")
            ]),
            fleetHStack([change, fleetSpacer()], spacing: 0)
        ])
    }

    private func shortcutDetail() {
        shell.showDetail(title: "Shortcut", subtitle: "Press ⌥L in any app to hear the text you are looking at.", body: [
            KernlAppShell.factCard("What ⌥L reads", [
                ("Selected text", "Read first, whenever anything is selected"),
                ("Nothing selected", "The main block of text in the window you are using"),
                ("In Chrome", "The extension reads the page instead, with the same voice"),
                ("Stop", "Press ⌥L again, or use the stop button on the player")
            ], note: "listnr needs Accessibility access to read selections and screen text.")
        ])
    }

    private func chromeDetail() {
        let open = fleetButton("Open extension folder", target: self, action: #selector(openExtension))
        shell.showDetail(title: "Chrome extension", subtitle: "Reads web pages aloud with the same local voice.", body: [
            KernlAppShell.factCard("Extension", [
                ("Version", Self.extensionVersion),
                ("Install", "chrome://extensions, turn on Developer mode, then Load unpacked and pick the extension folder"),
                ("Voice", "Shared with the desktop reader, set in listnr settings")
            ]),
            fleetHStack([open, fleetSpacer()], spacing: 0)
        ])
    }

    @objc private func openSettingsFromDetail() { shell.show(section: 1) }
    @objc private func openKeys() {
        NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fleet", isDirectory: true)
            .appendingPathComponent("fleet.env"))
    }
}
