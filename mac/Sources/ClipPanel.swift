import AppKit

/// Shows a clip in full before you save it, or opens a saved one to read.
/// Opened by ⌥⇧L, by the bookmark in the player, or from the Later page.
final class ClipPanel: NSPanel {
    enum Mode { case preview, saved(Clip) }

    var onListen: ((String) -> Void)?
    private var mode: Mode = .preview
    private var text = ""
    private var source = ""
    private var link = ""

    private let titleLabel = fleetLabel("", size: 17, weight: .semibold, color: KernlTheme.ink, lines: 2)
    private let sourceLabel = fleetLabel("", size: 12, color: KernlTheme.muted, lines: 1)
    private let countLabel = fleetLabel("", size: 12, color: KernlTheme.muted, lines: 1)
    private let body: NSTextView
    private let scroll: NSScrollView
    private let actions = NSStackView()

    init() {
        (scroll, body) = fleetTextScroll(editable: false)
        super.init(contentRect: NSRect(x: 0, y: 0, width: 520, height: 560),
                   styleMask: [.titled, .closable, .resizable, .fullSizeContentView, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        isFloatingPanel = true
        level = .floating
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        minSize = NSSize(width: 380, height: 320)
        // One quiet close in the header instead of the traffic lights; Esc closes too.
        for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            standardWindowButton(kind)?.isHidden = true
        }
        build()
    }

    override var canBecomeKey: Bool { true }

    private func build() {
        let card = KernlPanelCard()
        card.translatesAutoresizingMaskIntoConstraints = false
        contentView = card

        let name = fleetLabel("listnr", size: 13, weight: .semibold, color: KernlTheme.ink, lines: 1)
        let close = NSButton()
        close.bezelStyle = .regularSquare
        close.isBordered = false
        close.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close")
        close.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        close.contentTintColor = KernlTheme.muted
        close.toolTip = "Close (Esc)"
        close.target = self
        close.action = #selector(closePanel)
        let header = fleetHStack([KernlMarkView(kind: .listnr, size: 20), name, fleetSpacer(), sourceLabel, close], spacing: 7)
        header.setCustomSpacing(12, after: sourceLabel)

        body.font = Type.sans(14.5)
        body.textContainerInset = NSSize(width: 4, height: 10)
        let reading = NSView()
        reading.translatesAutoresizingMaskIntoConstraints = false
        reading.wantsLayer = true
        reading.layer?.cornerRadius = 14
        reading.layer?.borderWidth = 1
        reading.layer?.borderColor = KernlTheme.line.cgColor
        reading.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: reading.topAnchor, constant: 4),
            scroll.bottomAnchor.constraint(equalTo: reading.bottomAnchor, constant: -4),
            scroll.leadingAnchor.constraint(equalTo: reading.leadingAnchor, constant: 10),
            scroll.trailingAnchor.constraint(equalTo: reading.trailingAnchor, constant: -6)
        ])

        actions.orientation = .horizontal
        actions.spacing = 8
        let footer = fleetHStack([countLabel, fleetSpacer(), actions], spacing: 10)

        let column = fleetVStack([header, titleLabel, reading, footer], spacing: 12)
        column.setCustomSpacing(16, after: header)
        column.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
            column.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            column.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            column.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
            reading.widthAnchor.constraint(equalTo: column.widthAnchor),
            footer.widthAnchor.constraint(equalTo: column.widthAnchor),
            titleLabel.widthAnchor.constraint(equalTo: column.widthAnchor),
            reading.heightAnchor.constraint(greaterThanOrEqualToConstant: 160)
        ])
        reading.setContentHuggingPriority(.defaultLow, for: .vertical)
    }

    /// A new clip: show all of it, with Save for later and Listen.
    func preview(text: String, title: String, source: String) {
        mode = .preview
        fill(text: text, title: title, source: source, link: "")
        setActions([fleetButton("Listen", target: self, action: #selector(listen)),
                    fleetButton("Save for later", primary: true, target: self, action: #selector(save))])
        present()
    }

    /// A saved clip: read it, listen, open where it came from, or mark it done.
    func open(_ clip: Clip) {
        mode = .saved(clip)
        fill(text: clip.text, title: clip.title, source: clip.site, link: clip.url)
        var buttons = [fleetButton("Listen", target: self, action: #selector(listen))]
        if URL(string: clip.url)?.scheme?.hasPrefix("http") == true {
            buttons.append(fleetButton("Open page", target: self, action: #selector(openLink)))
        }
        buttons.append(fleetButton(clip.done ? "Mark unread" : "Done", primary: true, target: self, action: #selector(toggleDone)))
        setActions(buttons)
        present()
    }

    private func fill(text: String, title: String, source: String, link: String) {
        self.text = text
        self.source = source
        self.link = link
        titleLabel.stringValue = title
        sourceLabel.stringValue = source
        let words = text.split(whereSeparator: { $0.isWhitespace }).count
        countLabel.stringValue = "\(KernlNumber.grouped(words)) words, about \(max(1, Int((Double(words) / 230).rounded()))) min to read"
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 4
        style.paragraphSpacing = 10
        // Paragraph spacing does the gaps, so blank lines would double them.
        let shown = text.replacingOccurrences(of: #"\n\s*\n+"#, with: "\n", options: .regularExpression)
        body.textStorage?.setAttributedString(NSAttributedString(string: shown, attributes: [
            .font: Type.sans(14.5), .foregroundColor: KernlTheme.ink, .paragraphStyle: style
        ]))
        body.scrollToBeginningOfDocument(nil)
    }

    private func setActions(_ buttons: [NSView]) {
        actions.arrangedSubviews.forEach { $0.removeFromSuperview() }
        buttons.forEach { actions.addArrangedSubview($0) }
    }

    private func present() {
        if !isVisible {
            let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
            if let visible = screen?.visibleFrame {
                setFrameOrigin(NSPoint(x: visible.midX - frame.width / 2, y: visible.midY - frame.height / 2))
            }
        }
        makeKeyAndOrderFront(nil)
    }

    override func cancelOperation(_ sender: Any?) { orderOut(nil) }

    // MARK: Actions

    @objc private func listen() {
        orderOut(nil)
        onListen?(text)
    }

    @objc private func save() {
        let title = titleLabel.stringValue
        ClipStore.shared.save(title: title, site: source, kind: "selection", text: text) { [weak self] _ in
            guard let self else { return }
            self.countLabel.stringValue = "Saved to Later"
            self.setActions([fleetButton("Listen", target: self, action: #selector(self.listen)),
                             fleetButton("Close", primary: true, target: self, action: #selector(self.closePanel))])
        }
    }

    @objc private func openLink() {
        if let url = URL(string: link) { NSWorkspace.shared.open(url) }
    }

    @objc private func toggleDone() {
        guard case .saved(let clip) = mode else { return }
        ClipStore.shared.setDone(clip, !clip.done)
        orderOut(nil)
    }

    @objc private func closePanel() { orderOut(nil) }
}
