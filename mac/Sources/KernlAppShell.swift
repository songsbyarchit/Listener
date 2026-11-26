import AppKit

final class KernlFlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// The common full-app frame: a warm sidebar with the exact app mark, the
/// lowercase name, and a scrolling content area. Hotkey windows stay separate.
final class KernlSidebarRow: NSView {
    private let label = NSTextField(labelWithString: "")
    private var onClick: () -> Void = {}
    private var hovering = false { didSet { needsDisplay = true } }
    var isSelected = false { didSet { apply() } }

    init(title: String) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        layer?.cornerRadius = 9
        label.translatesAutoresizingMaskIntoConstraints = false
        label.stringValue = title
        label.font = Type.sans(14, .medium)
        label.textColor = KernlTheme.muted
        addSubview(label)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 32),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -10),
            label.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
        wantsLayer = true
    }
    required init?(coder: NSCoder) { fatalError() }

    func setClickHandler(_ handler: @escaping () -> Void) { onClick = handler }
    private func apply() {
        label.textColor = isSelected ? KernlTheme.ink : KernlTheme.muted
        needsDisplay = true
    }
    override func mouseDown(with event: NSEvent) { onClick() }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas where area.owner === self { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: .zero,
                                       options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func updateLayer() {
        if isSelected { layer?.backgroundColor = KernlTheme.soft.cgColor }
        else if hovering { layer?.backgroundColor = KernlTheme.soft.withAlphaComponent(0.55).cgColor }
        else { layer?.backgroundColor = NSColor.clear.cgColor }
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        apply()
        needsDisplay = true
    }
}

final class KernlSuiteMarkView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        translatesAutoresizingMaskIntoConstraints = false
    }
    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        let s = min(bounds.width, bounds.height)
        guard s > 4 else { return }
        let tile = NSBezierPath(roundedRect: NSRect(x: 0.5, y: 0.5, width: s - 1, height: s - 1),
                                xRadius: s * 0.28, yRadius: s * 0.28)
        NSColor(srgbRed: 0.078, green: 0.078, blue: 0.082, alpha: 1).setFill()
        tile.fill()
        // Four diagonal bands, one for each app, in grays.
        let bandColors = [
            NSColor(white: 0.24, alpha: 1),
            NSColor(white: 0.38, alpha: 1),
            NSColor(white: 0.52, alpha: 1),
            NSColor(white: 0.68, alpha: 1)
        ]
        for (index, color) in bandColors.enumerated() {
            let path = NSBezierPath()
            let offset = CGFloat(index) * s * 0.18
            path.move(to: NSPoint(x: -s * 0.2 + offset, y: s))
            path.line(to: NSPoint(x: s * 0.55 + offset, y: s))
            path.line(to: NSPoint(x: s + offset, y: s * 0.15))
            path.line(to: NSPoint(x: s + offset, y: -s * 0.2))
            path.close()
            color.setFill()
            path.fill()
        }
        // A cream hexagon sits over the four bands.
        let hex = NSBezierPath()
        let cx = s / 2, cy = s / 2, r = s * 0.26
        for i in 0..<6 {
            let angle = CGFloat(i) * .pi / 3 - .pi / 6
            let point = NSPoint(x: cx + cos(angle) * r, y: cy + sin(angle) * r)
            i == 0 ? hex.move(to: point) : hex.line(to: point)
        }
        hex.close()
        NSColor(srgbRed: 0.984, green: 0.914, blue: 0.808, alpha: 1).setFill()
        hex.fill()
        NSColor(srgbRed: 0.078, green: 0.078, blue: 0.082, alpha: 1).setStroke()
        hex.lineWidth = max(1, s * 0.035)
        hex.stroke()
    }
}

final class KernlAppShell: NSWindowController, NSWindowDelegate {
    let sections: [String]
    private let contentHost = NSView()
    private var rows: [KernlSidebarRow] = []
    var pageBuilder: (Int) -> NSView
    var onClose: (() -> Void)?
    private var selected = 0

    init(appName: String,
         tagline: String,
         mark: KernlAppMark,
         sections: [String],
         pageBuilder: @escaping (Int) -> NSView) {
        self.sections = sections
        self.pageBuilder = pageBuilder
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1040, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = appName
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 860, height: 600)
        window.isReleasedWhenClosed = false
        window.backgroundColor = KernlTheme.paper
        super.init(window: window)
        window.delegate = self
        build(appName: appName, tagline: tagline, mark: mark)
        window.center()
    }
    required init?(coder: NSCoder) { fatalError() }

    private func build(appName: String, tagline: String, mark: KernlAppMark) {
        guard let window else { return }
        let root = KernlBackdrop()
        window.contentView = root

        let sidebar = NSView()
        sidebar.translatesAutoresizingMaskIntoConstraints = false
        sidebar.wantsLayer = true
        sidebar.layer?.backgroundColor = KernlTheme.paper.cgColor

        let name = fleetLabel(appName, size: 20, weight: .semibold, color: KernlTheme.ink, lines: 1)
        let tag = fleetLabel(tagline, size: 12, color: KernlTheme.muted, lines: 2)
        let brand = fleetHStack([KernlMarkView(kind: mark, size: 30), name], spacing: 8)
        let brandBlock = fleetVStack([brand, tag], spacing: 4)
        brandBlock.translatesAutoresizingMaskIntoConstraints = false
        sidebar.addSubview(brandBlock)

        var navViews: [NSView] = []
        for (index, title) in sections.enumerated() {
            let row = KernlSidebarRow(title: title)
            row.setClickHandler { [weak self] in self?.show(section: index) }
            rows.append(row)
            navViews.append(row)
        }
        let nav = fleetVStack(navViews, spacing: 2)
        nav.translatesAutoresizingMaskIntoConstraints = false
        sidebar.addSubview(nav)

        let separator = NSView()
        separator.wantsLayer = true
        separator.layer?.backgroundColor = KernlTheme.line.cgColor
        separator.translatesAutoresizingMaskIntoConstraints = false

        contentHost.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(sidebar)
        root.addSubview(separator)
        root.addSubview(contentHost)

        NSLayoutConstraint.activate([
            sidebar.topAnchor.constraint(equalTo: root.topAnchor),
            sidebar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            sidebar.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            sidebar.widthAnchor.constraint(equalToConstant: 200),
            brandBlock.topAnchor.constraint(equalTo: sidebar.topAnchor, constant: 26),
            brandBlock.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 20),
            brandBlock.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -12),
            nav.topAnchor.constraint(equalTo: brandBlock.bottomAnchor, constant: 30),
            nav.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 10),
            nav.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -10),
            separator.topAnchor.constraint(equalTo: root.topAnchor),
            separator.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            separator.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor),
            separator.widthAnchor.constraint(equalToConstant: 1),
            contentHost.topAnchor.constraint(equalTo: root.topAnchor, constant: 32),
            contentHost.leadingAnchor.constraint(equalTo: separator.trailingAnchor, constant: 32),
            contentHost.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -32),
            contentHost.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -20)
        ])
        show(section: 0, activate: false)
    }

    func show(section: Int, activate: Bool = true) {
        guard sections.indices.contains(section) else { return }
        selected = section
        for (index, row) in rows.enumerated() { row.isSelected = index == section }
        contentHost.subviews.forEach { $0.removeFromSuperview() }
        let page = pageBuilder(section)
        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        let document = KernlFlippedView()
        document.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(page)
        scroll.documentView = document
        contentHost.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: contentHost.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: contentHost.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: contentHost.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: contentHost.bottomAnchor),
            document.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            document.trailingAnchor.constraint(equalTo: scroll.contentView.trailingAnchor),
            document.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            page.topAnchor.constraint(equalTo: document.topAnchor, constant: 2),
            page.leadingAnchor.constraint(equalTo: document.leadingAnchor),
            page.trailingAnchor.constraint(equalTo: document.trailingAnchor),
            page.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -24)
        ])
        if activate, let window {
            if !window.isVisible { window.center() }
            showWindow(nil)
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func windowWillClose(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in self?.onClose?() }
    }

    static func pageHeader(eyebrow: String, title: String, subtitle: String) -> NSView {
        fleetVStack([fleetEyebrow(eyebrow), fleetTitle(title),
                     fleetLabel(subtitle, size: 15, color: KernlTheme.muted, lines: 0)], spacing: 6)
    }

    static func statCard(label: String, value: String, foot: String) -> NSView {
        let valueLabel = fleetLabel(value, size: 29, weight: .medium, color: KernlTheme.ink, lines: 1)
        let labelLabel = fleetLabel(label, size: 11, weight: .medium, color: KernlTheme.muted, lines: 1)
        let footLabel = fleetLabel(foot, size: 11, color: KernlTheme.muted, lines: 2)
        return KernlCard(content: fleetVStack([valueLabel, labelLabel, footLabel], spacing: 4),
                         padding: NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16))
    }

    static func statRow(_ cards: [(label: String, value: String, foot: String)]) -> NSView {
        let views = cards.map { statCard(label: $0.label, value: $0.value, foot: $0.foot) }
        let row = fleetHStack(views, spacing: 12, alignment: .top)
        for view in views { view.widthAnchor.constraint(equalTo: views[0].widthAnchor).isActive = true }
        return row
    }

    static func linkButton(_ title: String, target: AnyObject, action: Selector) -> NSButton {
        fleetButton(title, target: target, action: action)
    }
}


/// The shared Kernl overview page: aggregate counts, appearance and shortcuts.
final class KernlPage: NSView {
    private var appearanceButtons: [NSButton] = []
    private let questionField = NSTextField()
    private let answerField = NSTextField(wrappingLabelWithString: "")
    private let askButton = NSButton()

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        build()
    }
    required init?(coder: NSCoder) { fatalError() }

    private func build() {
        let mark = KernlSuiteMarkView()
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.widthAnchor.constraint(equalToConstant: 44).isActive = true
        mark.heightAnchor.constraint(equalToConstant: 44).isActive = true
        let words = fleetVStack([
            fleetEyebrow("kernl"),
            fleetTitle("Kernl"),
            fleetLabel("All four apps, one place. Settings live inside each app.",
                       size: 15, color: KernlTheme.muted, lines: 0)
        ], spacing: 6)
        let header = fleetHStack([mark, words], spacing: 14, alignment: .top)
        let stats = KernlAppShell.statRow([
            ("speekr", "\(Self.count("~/.speekr/usage.json"))", "dictations"),
            ("writr", "\(Self.count("~/.writr/drafts.json"))", "drafts"),
            ("readr", "\(Self.count("~/.readr/lessons.json"))", "lessons"),
            ("listnr", "\(Self.count("~/.listnr/reads.json"))", "reads")
        ])
        let appearance = KernlCard(content: fleetVStack([
            fleetLabel("Appearance", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetLabel("Changes every app and the Chrome reader.", size: 12, color: KernlTheme.muted, lines: 2),
            appearanceRow()
        ], spacing: 10))
        let shortcuts = KernlCard(content: fleetVStack([
            fleetLabel("Shortcuts", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetLabel("Fn  hold to dictate\n⌥S  open speekr settings\n⌥W  draft in place\n⌥R  explain the screen\n⌥L  read selected text", size: 13, color: KernlTheme.muted, lines: 0)
        ], spacing: 10))
        let apps = KernlAppsCard()
        let ask = askCard()
        let folder = fleetButton("Open Kernl folder", target: self, action: #selector(openFolder))
        let column = fleetVStack([header, stats, apps, appearance, ask, shortcuts, folder], spacing: 18)
        addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: topAnchor),
            column.leadingAnchor.constraint(equalTo: leadingAnchor),
            column.trailingAnchor.constraint(equalTo: trailingAnchor),
            column.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    private func appearanceRow() -> NSView {
        let row = fleetHStack([], spacing: 6)
        for (index, title) in ["System", "Light", "Dark"].enumerated() {
            let button = fleetButton(title, target: self, action: #selector(appearanceTapped(_:)))
            button.tag = index
            appearanceButtons.append(button)
            row.addArrangedSubview(button)
        }
        refreshAppearance()
        return row
    }

    private func askCard() -> NSView {
        questionField.placeholderString = "Ask about speakr, listnr, writr or readr"
        questionField.font = Type.sans(13)
        questionField.isBezeled = true
        questionField.bezelStyle = .roundedBezel
        questionField.translatesAutoresizingMaskIntoConstraints = false
        questionField.target = self
        questionField.action = #selector(askTapped)

        askButton.title = "Ask"
        askButton.isBordered = false
        askButton.font = Type.sans(12, .medium)
        askButton.contentTintColor = KernlTheme.ink
        askButton.target = self
        askButton.action = #selector(askTapped)
        askButton.translatesAutoresizingMaskIntoConstraints = false
        askButton.wantsLayer = true
        askButton.layer?.backgroundColor = KernlTheme.soft.cgColor
        askButton.layer?.cornerRadius = 8

        answerField.font = Type.sans(13)
        answerField.textColor = KernlTheme.ink
        answerField.maximumNumberOfLines = 0
        answerField.lineBreakMode = .byWordWrapping
        answerField.translatesAutoresizingMaskIntoConstraints = false
        answerField.stringValue = "Answers come only from the local Kernl FAQ, never the public web."

        let input = fleetHStack([questionField, askButton], spacing: 8)
        return KernlCard(content: fleetVStack([
            fleetLabel("Ask Kernl", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            input, answerField
        ], spacing: 10))
    }

    @objc private func askTapped() {
        let query = questionField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        answerField.stringValue = "Searching the Kernl FAQ…"
        KernlKnowledge.answer(query) { [weak self] text in
            DispatchQueue.main.async { self?.answerField.stringValue = text }
        }
    }

    private func refreshAppearance() {
        let current = KernlAppearance.value()
        for (index, button) in appearanceButtons.enumerated() {
            button.state = ["system", "light", "dark"][index] == current ? .on : .off
        }
    }

    @objc private func appearanceTapped(_ sender: NSButton) {
        let value = ["system", "light", "dark"][max(0, min(sender.tag, 2))]
        KernlAppearance.set(value)
        refreshAppearance()
    }

    @objc private func openFolder() {
        NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fleet", isDirectory: true))
    }

    private static func count(_ path: String) -> Int {
        let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) else { return 0 }
        if let array = object as? [Any] { return array.count }
        if let dictionary = object as? [String: Any],
           let array = dictionary["entries"] as? [Any] { return array.count }
        return 0
    }
}


final class KernlAppsCard: NSView {
    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let names = ["speakr", "listnr", "writr", "readr"]
        let row = fleetHStack([], spacing: 8)
        for (index, name) in names.enumerated() {
            let button = fleetButton(name, target: self, action: #selector(openApp(_:)))
            button.tag = index
            row.addArrangedSubview(button)
        }
        let card = KernlCard(content: fleetVStack([
            fleetLabel("Apps", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetLabel("Open an app; its own settings live inside.", size: 11, color: KernlTheme.muted, lines: 1),
            row
        ], spacing: 10))
        addSubview(card)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: topAnchor),
            card.leadingAnchor.constraint(equalTo: leadingAnchor),
            card.trailingAnchor.constraint(equalTo: trailingAnchor),
            card.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func openApp(_ sender: NSButton) {
        let names = ["speakr", "listnr", "writr", "readr"]
        guard names.indices.contains(sender.tag) else { return }
        let name = names[sender.tag]
        let home = FileManager.default.homeDirectoryForCurrentUser
        let display = name == "speakr" ? "Speakr" : name.capitalized
        let candidates: [URL] = [
            URL(fileURLWithPath: "/Applications/\(name).app"),
            URL(fileURLWithPath: "/Applications/\(display).app"),
            home.appendingPathComponent("Downloads/speakr/build/\(display).app"),
            home.appendingPathComponent("Downloads/speekr/build/\(display).app"),
            home.appendingPathComponent("Downloads/writr/build/Writr.app"),
            home.appendingPathComponent("Downloads/readr/build/Readr.app"),
            home.appendingPathComponent("Downloads/Listener/mac/build/listnr.app")
        ]
        for url in candidates where FileManager.default.fileExists(atPath: url.path) {
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
            return
        }
    }
}

enum KernlKnowledge {
    struct Entry { let title: String; let body: String }

    static func answer(_ query: String, completion: @escaping (String) -> Void) {
        let entries = loadEntries()
        let q = tokens(query)
        let scored = entries.map { entry -> (Entry, Int) in
            let hay = tokens(entry.title + " " + entry.body)
            return (entry, q.reduce(0) { $0 + (hay.contains($1) ? 1 : 0) })
        }.sorted { $0.1 > $1.1 }
        let top = scored.prefix(3)
        let best = top.first?.1 ?? 0
        let nearest = top.filter { $0.1 > 0 }.map(\.0.title)

        if best == 0 {
            let q = query.lowercased()
            let fallback = entries
                .map { ($0.title, Self.fuzzyScore(q, $0.title + " " + $0.body)) }
                .sorted { $0.1 > $1.1 }
                .prefix(3)
                .map(\.0)
            completion("Nothing in the Kernl knowledge base matches that closely. Did you mean: \(fallback.joined(separator: ", "))?")
            return
        }
        let context = top.map { "## \($0.0.title)\n\($0.0.body)" }.joined(separator: "\n\n")
        let prefix = best == 1 ? "This is a near match, not a full match. Closest entries: \(nearest.joined(separator: ", ")).\n\n" : ""
        guard let key = envKey() else {
            completion(prefix + "Add OPENAI_API_KEY to ~/.fleet/fleet.env to use the Kernl assistant.")
            return
        }
        let system = "You are Kernl's local FAQ assistant. Answer only from the knowledge base entries below. If the answer is not in them, say so. Never use outside knowledge from the web."
        let user = "Question: \(query)\n\nKnowledge base:\n\(context)"
        let body: [String: Any] = [
            "model": "gpt-4o-mini",
            "temperature": 0.1,
            "messages": [
                ["role": "system", "content": system],
                ["role": "user", "content": user]
            ]
        ]
        guard let url = URL(string: "https://api.openai.com/v1/chat/completions") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, error in
            if let error {
                completion(prefix + "The FAQ assistant could not answer: \(error.localizedDescription)")
                return
            }
            guard let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = object["choices"] as? [[String: Any]],
                  let message = choices.first?["message"] as? [String: Any],
                  let text = message["content"] as? String else {
                completion(prefix + "The FAQ assistant returned no answer.")
                return
            }
            completion(prefix + text.trimmingCharacters(in: .whitespacesAndNewlines))
        }.resume()
    }

    private static func loadEntries() -> [Entry] {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fleet", isDirectory: true)
            .appendingPathComponent("faqs.md")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        let parts = text.components(separatedBy: "\n## ").dropFirst()
        return parts.map { part in
            let lines = part.components(separatedBy: .newlines)
            let title = lines.first?.trimmingCharacters(in: .whitespaces) ?? "Kernl"
            return Entry(title: title, body: lines.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    private static func envKey() -> String? {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fleet", isDirectory: true)
            .appendingPathComponent("fleet.env")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        for line in text.components(separatedBy: .newlines) {
            let clean = line.trimmingCharacters(in: .whitespaces)
            guard clean.hasPrefix("OPENAI_API_KEY=") else { continue }
            let value = String(clean.dropFirst("OPENAI_API_KEY=".count))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : value
        }
        return nil
    }

    private static func fuzzyScore(_ query: String, _ text: String) -> Int {
        let q = Array(query.lowercased())
        let t = Array(text.lowercased())
        guard q.count >= 3, t.count >= 3 else { return 0 }
        let grams = Set((0...(q.count - 3)).map { String(q[$0..<($0 + 3)]) })
        return grams.reduce(0) { score, gram in
            score + (text.lowercased().contains(gram) ? 1 : 0)
        }
    }

    private static func tokens(_ text: String) -> Set<String> {
        let stop: Set<String> = ["the", "a", "an", "and", "or", "to", "of", "in", "on",
                                 "is", "are", "what", "how", "does", "do", "i", "my",
                                 "for", "with", "it", "this", "that", "can", "you"]
        let words = text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        return Set(words.map(String.init).filter { $0.count > 1 && !stop.contains($0) })
    }
}
