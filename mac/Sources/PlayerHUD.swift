import Foundation
import AppKit

/// The small read-along player that appears when listnr reads. It shows the
/// line being spoken with the current word lit, a progress bar with elapsed and
/// total time, and pause and stop. Fixed width, so long text wraps instead of
/// stretching the panel.
final class PlayerHUD: NSPanel {
    static let width: CGFloat = 380

    private let status = NSTextField(labelWithString: "")
    private let lineField = NSTextField(wrappingLabelWithString: "")
    private let bar = ReadAlongBar()
    private let elapsed = NSTextField(labelWithString: "0:00")
    private let remaining = NSTextField(labelWithString: "0:00")
    private let pauseButton = NSButton()
    private let stopButton = NSButton()
    private let speedButton = NSButton()
    private lazy var controls = NSStackView(views: [elapsed, bar, remaining, speedButton, pauseButton, stopButton])

    private var timeline = ReadAlongTimeline("")
    private var lines: [Range<Int>] = []
    private var currentWord = -1
    private var state: Speaker.State = .finished
    private var ticker: Timer?
    private var hideWork: DispatchWorkItem?

    var onPause: (() -> Void)?
    var onStop: (() -> Void)?
    /// Moves to the next speed and returns it.
    var onSpeed: (() -> Float)?
    /// The current speed, for the button label.
    var speedProvider: (() -> Float)?
    /// Asked on every tick for the playback position.
    var progressProvider: (() -> Speaker.Progress?)?

    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 150),
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
        build()
    }

    required init?(coder: NSCoder) { fatalError() }

    private func build() {
        let card = KernlPanelCard()
        card.translatesAutoresizingMaskIntoConstraints = false
        contentView = card

        let mark = KernlMarkView(kind: .listnr, size: 20)
        let name = NSTextField(labelWithString: "listnr")
        name.font = Type.sans(13, .semibold)
        name.textColor = KernlTheme.ink
        status.font = Type.sans(12)
        status.textColor = KernlTheme.muted
        status.alignment = .right
        let header = fleetHStack([mark, name, fleetSpacer(), status], spacing: 7)

        lineField.font = Type.sans(15)
        lineField.textColor = KernlTheme.ink
        lineField.maximumNumberOfLines = 3
        lineField.isSelectable = false
        lineField.cell?.lineBreakMode = .byWordWrapping
        lineField.preferredMaxLayoutWidth = Self.width - 36
        lineField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        for label in [elapsed, remaining] {
            label.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
            label.textColor = KernlTheme.muted
            label.setContentHuggingPriority(.required, for: .horizontal)
            label.setContentCompressionResistancePriority(.required, for: .horizontal)
        }
        bar.setContentHuggingPriority(.defaultLow, for: .horizontal)
        configure(pauseButton, symbol: "pause.fill", label: "Pause", action: #selector(pauseTapped))
        configure(stopButton, symbol: "stop.fill", label: "Stop", action: #selector(stopTapped))
        controls.orientation = .horizontal
        controls.alignment = .centerY
        controls.spacing = 10
        speedButton.bezelStyle = .regularSquare
        speedButton.isBordered = false
        speedButton.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
        speedButton.contentTintColor = KernlTheme.ink
        speedButton.target = self
        speedButton.action = #selector(speedTapped)
        speedButton.toolTip = "Playback speed"
        speedButton.translatesAutoresizingMaskIntoConstraints = false
        speedButton.widthAnchor.constraint(equalToConstant: 42).isActive = true
        speedButton.heightAnchor.constraint(equalToConstant: 28).isActive = true
        speedButton.wantsLayer = true
        speedButton.layer?.cornerRadius = 14
        speedButton.layer?.backgroundColor = KernlTheme.soft.cgColor
        setSpeedLabel(1)
        controls.setCustomSpacing(14, after: remaining)
        controls.setCustomSpacing(4, after: speedButton)
        controls.setCustomSpacing(4, after: pauseButton)
        controls.translatesAutoresizingMaskIntoConstraints = false

        let column = fleetVStack([header, lineField, controls], spacing: 12)
        column.setCustomSpacing(14, after: lineField)
        card.addSubview(column)
        NSLayoutConstraint.activate([
            card.widthAnchor.constraint(equalToConstant: Self.width),
            column.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            column.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            column.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            column.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            lineField.heightAnchor.constraint(greaterThanOrEqualToConstant: 40)
        ])
    }

    private func configure(_ button: NSButton, symbol: String, label: String, action: Selector) {
        button.bezelStyle = .regularSquare
        button.isBordered = false
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        button.contentTintColor = KernlTheme.ink
        button.setAccessibilityLabel(label)
        button.toolTip = label
        button.target = self
        button.action = action
        button.translatesAutoresizingMaskIntoConstraints = false
        button.widthAnchor.constraint(equalToConstant: 28).isActive = true
        button.heightAnchor.constraint(equalToConstant: 28).isActive = true
        button.wantsLayer = true
        button.layer?.cornerRadius = 14
        button.layer?.backgroundColor = KernlTheme.soft.cgColor
    }

    // MARK: Public

    /// Starts a new read-along for `text`.
    func show(text: String, status textStatus: String) {
        hideWork?.cancel()
        timeline = ReadAlongTimeline(text)
        lines = timeline.lines(maxWords: 12)
        currentWord = -1
        controls.isHidden = false
        bar.fraction = 0
        elapsed.stringValue = "0:00"
        remaining.stringValue = "0:00"
        status.stringValue = textStatus
        setSpeedLabel(speedProvider?() ?? 1)
        render(word: 0, spoken: false)
        startTicker()
        present()
    }

    func update(_ state: Speaker.State, text: String) {
        self.state = state
        switch state {
        case .preparing:
            status.stringValue = "Preparing voice"
        case .speaking:
            status.stringValue = "Reading"
            setPauseIcon(paused: false)
            startTicker()
        case .paused:
            status.stringValue = "Paused"
            setPauseIcon(paused: true)
            hideWork?.cancel()
        case .finished:
            status.stringValue = "Done"
            ticker?.invalidate()
            if !timeline.words.isEmpty { render(word: timeline.words.count - 1, spoken: true) }
            bar.fraction = 1
            scheduleHide(after: 1.6)
        }
    }

    func showError(_ message: String) {
        hideWork?.cancel()
        ticker?.invalidate()
        timeline = ReadAlongTimeline("")
        status.stringValue = "Needs attention"
        controls.isHidden = true
        lineField.attributedStringValue = NSAttributedString(string: message, attributes: [
            .font: Type.sans(14), .foregroundColor: KernlTheme.ink
        ])
        present()
        scheduleHide(after: 6)
    }

    // MARK: Read-along

    private func startTicker() {
        ticker?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 15.0, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func tick() {
        guard state == .speaking || state == .preparing, let progress = progressProvider?() else { return }
        switch progress {
        case let .audio(character, time, total):
            let duration = max(total, time)
            bar.fraction = duration > 0 ? time / duration : 0
            elapsed.stringValue = ReadAlongTimeline.clock(time)
            remaining.stringValue = ReadAlongTimeline.clock(duration)
            render(word: timeline.wordIndex(atCharacter: character), spoken: true)
        case let .character(location):
            let index = timeline.wordIndex(atCharacter: location)
            bar.fraction = timeline.words.isEmpty ? 0 : Double(index + 1) / Double(timeline.words.count)
            elapsed.stringValue = "\(index + 1)"
            remaining.stringValue = "\(timeline.words.count) words"
            render(word: index, spoken: true)
        }
    }

    /// Shows the line holding `word`, with earlier words in ink, the current word
    /// lit in the accent, and the words still to come muted.
    private func render(word: Int, spoken: Bool) {
        guard !timeline.words.isEmpty, word != currentWord || !spoken else { return }
        currentWord = spoken ? word : -1
        let lineRange = lines.first { $0.contains(word) } ?? 0..<min(timeline.words.count, 12)
        let output = NSMutableAttributedString()
        for index in lineRange {
            let isCurrent = spoken && index == word
            let isSpoken = spoken && index < word
            let attributes: [NSAttributedString.Key: Any] = [
                .font: Type.sans(15, isCurrent ? .semibold : .regular),
                .foregroundColor: isCurrent ? KernlTheme.accent : (isSpoken ? KernlTheme.ink : KernlTheme.muted)
            ]
            if output.length > 0 { output.append(NSAttributedString(string: " ", attributes: attributes)) }
            output.append(NSAttributedString(string: timeline.words[index].text, attributes: attributes))
        }
        lineField.attributedStringValue = output
    }

    private func setPauseIcon(paused: Bool) {
        pauseButton.image = NSImage(systemSymbolName: paused ? "play.fill" : "pause.fill",
                                    accessibilityDescription: paused ? "Continue" : "Pause")
        pauseButton.setAccessibilityLabel(paused ? "Continue" : "Pause")
        pauseButton.toolTip = paused ? "Continue" : "Pause"
    }

    // MARK: Window

    private func present() {
        contentView?.layoutSubtreeIfNeeded()
        let height = contentView?.fittingSize.height ?? 150
        setContentSize(NSSize(width: Self.width, height: height))
        position()
        orderFrontRegardless()
    }

    private func scheduleHide(after seconds: Double) {
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.ticker?.invalidate()
            self?.orderOut(nil)
        }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func position() {
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
        guard let visible = screen?.visibleFrame else { return }
        setFrameOrigin(NSPoint(x: visible.maxX - frame.width - 20, y: visible.minY + 20))
    }

    private func setSpeedLabel(_ speed: Float) {
        let text = speed == Float(Int(speed)) ? "\(Int(speed))×" : "\(speed)×"
        speedButton.attributedTitle = NSAttributedString(string: text, attributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: KernlTheme.ink
        ])
        speedButton.setAccessibilityLabel("Speed \(text). Change speed")
    }

    @objc private func speedTapped() {
        if let speed = onSpeed?() { setSpeedLabel(speed) }
    }

    @objc private func pauseTapped() { onPause?() }
    @objc private func stopTapped() { onStop?() }
}

/// A thin rounded progress track filled with the app accent.
final class ReadAlongBar: NSView {
    var fraction: Double = 0 { didSet { needsDisplay = true } }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 4).isActive = true
        widthAnchor.constraint(greaterThanOrEqualToConstant: 120).isActive = true
        setAccessibilityRole(.progressIndicator)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ dirtyRect: NSRect) {
        let track = NSBezierPath(roundedRect: bounds, xRadius: 2, yRadius: 2)
        KernlTheme.soft.setFill()
        track.fill()
        let width = bounds.width * CGFloat(max(0, min(1, fraction)))
        guard width > 0 else { return }
        KernlTheme.accent.setFill()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: max(4, width), height: bounds.height),
                     xRadius: 2, yRadius: 2).fill()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}
