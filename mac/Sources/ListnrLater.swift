import AppKit

/// Later: the clips you saved to read or listen to, from Chrome and from any app.
final class ListnrLaterPage: NSView {
    private let onListen: (String) -> Void
    private let onOpen: (Clip) -> Void
    private let list = NSStackView()
    private var showDone = false
    private var observer: NSObjectProtocol?

    init(onListen: @escaping (String) -> Void, onOpen: @escaping (Clip) -> Void) {
        self.onListen = onListen
        self.onOpen = onOpen
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        list.orientation = .vertical
        list.alignment = .leading
        list.spacing = 12
        list.translatesAutoresizingMaskIntoConstraints = false
        let filter = KernlPillChoice(["To read", "Done"], selected: 0) { [weak self] in
            self?.showDone = $0 == 1
            self?.reload()
        }
        let card = KernlCard(content: list)
        let column = fleetVStack([
            KernlAppShell.pageHeader(eyebrow: "", title: "Later",
                                     subtitle: "Articles and selections you clipped. Read them here, or listen while you do something else."),
            filter, card
        ], spacing: 18)
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: topAnchor), column.bottomAnchor.constraint(equalTo: bottomAnchor),
            column.leadingAnchor.constraint(equalTo: leadingAnchor), column.trailingAnchor.constraint(equalTo: trailingAnchor),
            card.widthAnchor.constraint(equalTo: column.widthAnchor),
            list.widthAnchor.constraint(equalTo: card.widthAnchor, constant: -40)
        ])
        reload()
        observer = NotificationCenter.default.addObserver(forName: ClipStore.changed, object: nil, queue: .main) { [weak self] _ in
            self?.reload()
        }
        ClipStore.shared.refresh()
    }
    required init?(coder: NSCoder) { fatalError() }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    private func reload() {
        list.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let clips = ClipStore.shared.clips.filter { $0.done == showDone }
        if clips.isEmpty {
            add(fleetLabel(showDone ? "Clips you mark done show up here."
                                    : "Nothing saved yet. Press ⌥⇧L on a page in Chrome or on a selection in any app, check the preview, then save it.",
                           size: 13, color: KernlTheme.muted, lines: 0))
            return
        }
        for (index, clip) in clips.enumerated() {
            if index > 0 { add(KernlHairlineView()) }
            add(row(clip))
        }
    }

    private func add(_ view: NSView) {
        list.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: list.widthAnchor).isActive = true
    }

    private func row(_ clip: Clip) -> NSView {
        var meta = [clip.kind == "selection" ? "Selection" : "Article", "\(clip.minutes) min"]
        if !clip.site.isEmpty { meta.append(clip.site) }
        if let date = clip.savedAt { meta.append(Self.relative.localizedString(for: date, relativeTo: Date())) }
        if clip.local == true { meta.append("on this Mac") }
        let preview = clip.text.replacingOccurrences(of: "\n", with: " ")
        let text = fleetVStack([
            fleetLabel(clip.title, size: 14, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetLabel(String(preview.prefix(220)), size: 12.5, color: KernlTheme.muted, lines: 2),
            fleetLabel(meta.joined(separator: ", "), size: 11.5, color: KernlTheme.muted, lines: 1)
        ], spacing: 3)
        text.setContentHuggingPriority(.defaultLow, for: .horizontal)
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        var buttons = [ClipIconButton("play.fill", "Listen") { [weak self] in self?.onListen(clip.text) },
                       ClipIconButton("text.alignleft", "Read") { [weak self] in self?.onOpen(clip) }]
        if let url = URL(string: clip.url), url.scheme?.hasPrefix("http") == true {
            buttons.append(ClipIconButton("arrow.up.right", "Open page") { NSWorkspace.shared.open(url) })
        }
        buttons.append(ClipIconButton(clip.done ? "arrow.uturn.backward" : "checkmark", clip.done ? "Mark unread" : "Done") {
            ClipStore.shared.setDone(clip, !clip.done)
        })
        buttons.append(ClipIconButton("trash", "Remove") { ClipStore.shared.remove(clip) })
        let row = ClipRow(fleetHStack([text, fleetSpacer(), fleetHStack(buttons, spacing: 2)], spacing: 12)) { [weak self] in
            self?.onOpen(clip)
        }
        // Let the text take the room the buttons leave, instead of wrapping early.
        text.widthAnchor.constraint(greaterThanOrEqualTo: row.widthAnchor, multiplier: 0.62).isActive = true
        return row
    }

    private static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()
}

/// A clip row: click anywhere outside the buttons to read the clip.
private final class ClipRow: NSView {
    private let action: () -> Void
    init(_ content: NSView, action: @escaping () -> Void) {
        self.action = action
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        content.translatesAutoresizingMaskIntoConstraints = false
        addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: leadingAnchor), content.trailingAnchor.constraint(equalTo: trailingAnchor),
            content.topAnchor.constraint(equalTo: topAnchor), content.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
    override func mouseUp(with event: NSEvent) { action() }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
}

/// A small muted icon that turns ink on hover, the same size as the copy icon.
private final class ClipIconButton: NSButton {
    private let handler: () -> Void
    init(_ symbol: String, _ label: String, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(frame: .zero)
        bezelStyle = .regularSquare
        isBordered = false
        image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        contentTintColor = KernlTheme.muted
        toolTip = label
        setAccessibilityLabel(label)
        target = self
        action = #selector(run)
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: 28).isActive = true
        heightAnchor.constraint(equalToConstant: 28).isActive = true
    }
    required init?(coder: NSCoder) { fatalError() }
    @objc private func run() { handler() }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { contentTintColor = KernlTheme.ink }
    override func mouseExited(with event: NSEvent) { contentTintColor = KernlTheme.muted }
}
