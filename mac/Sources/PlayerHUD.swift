import Foundation
import AppKit

final class PlayerHUD: NSPanel {
    private let snippet = NSTextField(labelWithString: "")
    private let status = NSTextField(labelWithString: "")
    private let pauseButton = NSButton()
    private let stopButton = NSButton()
    private var hideWork: DispatchWorkItem?
    var onPause: (() -> Void)?
    var onStop: (() -> Void)?

    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 420, height: 132),
                   styleMask: [.nonactivatingPanel, .borderless],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        becomesKeyOnlyIfNeeded = true
        hidesOnDeactivate = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true

        let card = LoomPanelCard()
        card.translatesAutoresizingMaskIntoConstraints = false
        contentView = card

        let mark = LoomMarkView(kind: .listnr, size: 30)
        let name = NSTextField(labelWithString: "listnr")
        name.font = Type.sans(14, .semibold)
        name.textColor = FleetTheme.ink
        name.translatesAutoresizingMaskIntoConstraints = false
        let brand = NSStackView(views: [mark, name])
        brand.orientation = .horizontal
        brand.alignment = .centerY
        brand.spacing = 8
        brand.translatesAutoresizingMaskIntoConstraints = false

        status.font = Type.sans(11, .medium)
        status.textColor = FleetTheme.muted
        status.translatesAutoresizingMaskIntoConstraints = false
        let header = NSStackView(views: [brand, fleetSpacer(), status])
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 8
        header.translatesAutoresizingMaskIntoConstraints = false

        snippet.font = Type.sans(13)
        snippet.textColor = FleetTheme.ink
        snippet.maximumNumberOfLines = 2
        snippet.lineBreakMode = .byTruncatingTail
        snippet.translatesAutoresizingMaskIntoConstraints = false

        pauseButton.title = "Pause"
        pauseButton.isBordered = false
        pauseButton.font = Type.sans(12, .medium)
        pauseButton.contentTintColor = FleetTheme.ink
        pauseButton.target = self
        pauseButton.action = #selector(pauseTapped)
        pauseButton.translatesAutoresizingMaskIntoConstraints = false
        pauseButton.wantsLayer = true
        pauseButton.layer?.backgroundColor = FleetTheme.soft.cgColor
        pauseButton.layer?.cornerRadius = 8

        stopButton.title = "Stop"
        stopButton.isBordered = false
        stopButton.font = Type.sans(12, .medium)
        stopButton.contentTintColor = FleetTheme.muted
        stopButton.target = self
        stopButton.action = #selector(stopTapped)
        stopButton.translatesAutoresizingMaskIntoConstraints = false

        let buttons = NSStackView(views: [pauseButton, stopButton])
        buttons.orientation = .horizontal
        buttons.spacing = 10
        buttons.translatesAutoresizingMaskIntoConstraints = false

        let text = NSStackView(views: [header, snippet, buttons])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 8
        text.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(text)
        NSLayoutConstraint.activate([
            text.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            text.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            text.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            text.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
            header.widthAnchor.constraint(equalTo: text.widthAnchor),
            snippet.widthAnchor.constraint(equalTo: text.widthAnchor),
            pauseButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 70),
            pauseButton.heightAnchor.constraint(equalToConstant: 28)
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(text: String, status textStatus: String) {
        hideWork?.cancel()
        snippet.stringValue = text
        status.stringValue = textStatus
        pauseButton.layer?.backgroundColor = FleetTheme.soft.cgColor
        pauseButton.contentTintColor = FleetTheme.ink
        stopButton.contentTintColor = FleetTheme.muted
        position()
        orderFrontRegardless()
    }

    func update(_ state: Speaker.State, text: String) {
        snippet.stringValue = text
        switch state {
        case .speaking:
            status.stringValue = "reading"
            pauseButton.title = "Pause"
        case .paused:
            status.stringValue = "paused"
            pauseButton.title = "Continue"
            hideWork?.cancel()
        case .finished:
            status.stringValue = "done"
            scheduleHide(after: 1.2)
        }
    }

    func showError(_ message: String) {
        show(text: message, status: "needs attention")
        scheduleHide(after: 6)
    }

    private func scheduleHide(after seconds: Double) {
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.orderOut(nil) }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func position() {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        setFrameOrigin(NSPoint(x: visible.maxX - frame.width - 20,
                               y: visible.minY + 20))
    }

    @objc private func pauseTapped() { onPause?() }
    @objc private func stopTapped() { onStop?() }
}
