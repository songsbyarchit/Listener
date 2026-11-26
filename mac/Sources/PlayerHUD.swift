import Foundation
import AppKit

/// The small read-along player that appears when listnr reads. It shows the
/// line being spoken with the current word lit, a progress bar with elapsed and
/// total time, and playback controls. Small by default, resizable, and the
/// text fills whatever space it has.
final class PlayerHUD: NSPanel {
    private var expanded = false
    /// Small and out of the way by default: listening is the point. Expand
    /// is a focus mode for reading along.
    static let compactSize = NSSize(width: 380, height: 196)
    static let expandedSize = NSSize(width: 620, height: 400)
    /// Larger text once the player is wide enough to hold it.
    private var textSize: CGFloat { frame.width >= 520 ? 19 : 15 }
    /// Where the person left the player this session, so it reopens there.
    private var placedFrame: NSRect?
    private let settingsButton = NSButton()
    private let expandButton = NSButton()
    private let closeButton = NSButton()
    private let muteButton = NSButton()

    private let status = NSTextField(labelWithString: "")
    private let lineField = NSTextField(wrappingLabelWithString: "")
    private let bar = ReadAlongBar()
    private let elapsed = NSTextField(labelWithString: "0:00")
    private let remaining = NSTextField(labelWithString: "0:00")
    private let pauseButton = NSButton()
    private let stopButton = NSButton()
    private let speedButton = NSButton()
    private let leftSpacer = fleetSpacer()
    private let rightSpacer = fleetSpacer()
    /// Time at each end, the three playback buttons centred between them.
    private lazy var controls = NSStackView(views: [elapsed, leftSpacer, speedButton, pauseButton, stopButton, rightSpacer, remaining])
    /// The progress bar and the controls under it.
    private lazy var transport = fleetVStack([bar, controls], spacing: 8)

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
    /// Toggles mute and returns whether it is now muted.
    var onMute: (() -> Bool)?
    /// Opens listnr settings.
    var onSettings: (() -> Void)?
    /// The current speed, for the button label.
    var speedProvider: (() -> Float)?
    /// Asked on every tick for the playback position.
    var progressProvider: (() -> Speaker.Progress?)?

    init() {
        super.init(contentRect: NSRect(origin: .zero, size: Self.compactSize),
                   styleMask: [.nonactivatingPanel, .borderless, .resizable],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        becomesKeyOnlyIfNeeded = true
        hidesOnDeactivate = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        // Drag from the top or anywhere on the background; resize from any
        // edge or corner. A bigger player simply shows more of the text.
        isMovableByWindowBackground = true
        minSize = NSSize(width: 340, height: 180)
        maxSize = NSSize(width: 1000, height: 820)
        build()
        NotificationCenter.default.addObserver(self, selector: #selector(resized),
                                               name: NSWindow.didResizeNotification, object: self)
        NotificationCenter.default.addObserver(self, selector: #selector(moved),
                                               name: NSWindow.didMoveNotification, object: self)
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
        configureQuiet(settingsButton, symbol: "gearshape", label: "listnr settings", action: #selector(settingsTapped))
        configureQuiet(expandButton, symbol: "arrow.up.left.and.arrow.down.right", label: "Bigger player", action: #selector(expandTapped))
        configureQuiet(closeButton, symbol: "xmark", label: "Stop and close", action: #selector(closeTapped))
        configureQuiet(muteButton, symbol: "speaker.wave.2", label: "Mute", action: #selector(muteTapped))
        let tools = fleetHStack([muteButton, settingsButton, expandButton, closeButton], spacing: 2)
        let header = fleetHStack([mark, name, status, fleetSpacer(), tools], spacing: 7)
        header.setCustomSpacing(10, after: name)

        lineField.font = Type.sans(15)
        lineField.textColor = KernlTheme.ink
        lineField.maximumNumberOfLines = 0
        lineField.isSelectable = false
        lineField.cell?.lineBreakMode = .byWordWrapping
        lineField.preferredMaxLayoutWidth = Self.compactSize.width - 36
        lineField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        // The window size wins over the text: extra words are clipped, not
        // allowed to grow the player.
        lineField.setContentCompressionResistancePriority(NSLayoutConstraint.Priority(240), for: .vertical)
        lineField.setContentHuggingPriority(NSLayoutConstraint.Priority(200), for: .vertical)
        lineField.cell?.truncatesLastVisibleLine = true

        for label in [elapsed, remaining] {
            label.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
            label.textColor = KernlTheme.muted
            label.setContentHuggingPriority(.required, for: .horizontal)
            label.setContentCompressionResistancePriority(.required, for: .horizontal)
        }
        bar.setContentHuggingPriority(.defaultLow, for: .horizontal)
        configure(pauseButton, symbol: "pause.fill", label: "Pause", action: #selector(pauseTapped))
        configure(stopButton, symbol: "stop.fill", label: "Stop", action: #selector(stopTapped))
        // Play and pause is the main control: a solid accent circle with the
        // icon in the page colour, so it reads in light and dark mode.
        pauseButton.layer?.backgroundColor = KernlTheme.accent.cgColor
        pauseButton.contentTintColor = KernlTheme.paper
        pauseButton.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 16, weight: .bold)
        for constraint in pauseButton.constraints where constraint.firstAttribute == .width || constraint.firstAttribute == .height {
            constraint.constant = 40
        }
        pauseButton.layer?.cornerRadius = 20
        controls.orientation = .horizontal
        controls.alignment = .centerY
        controls.spacing = 12
        controls.distribution = .fill
        leftSpacer.widthAnchor.constraint(equalTo: rightSpacer.widthAnchor).isActive = true
        speedButton.bezelStyle = .regularSquare
        speedButton.isBordered = false
        speedButton.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
        speedButton.contentTintColor = KernlTheme.ink
        speedButton.target = self
        speedButton.action = #selector(speedTapped)
        speedButton.toolTip = "Playback speed"
        speedButton.translatesAutoresizingMaskIntoConstraints = false
        speedButton.widthAnchor.constraint(equalToConstant: 48).isActive = true
        speedButton.heightAnchor.constraint(equalToConstant: 32).isActive = true
        speedButton.wantsLayer = true
        speedButton.layer?.cornerRadius = 16
        speedButton.layer?.backgroundColor = KernlTheme.soft.cgColor
        setSpeedLabel(1)
        controls.translatesAutoresizingMaskIntoConstraints = false

        transport.translatesAutoresizingMaskIntoConstraints = false
        let column = fleetVStack([header, lineField, transport], spacing: 12)
        column.setCustomSpacing(14, after: lineField)
        card.addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            column.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            column.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            column.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            lineField.heightAnchor.constraint(greaterThanOrEqualToConstant: 40)
        ])
    }

    /// Small header icons: no fill, muted, ink on hover through the tint.
    private func configureQuiet(_ button: NSButton, symbol: String, label: String, action: Selector) {
        button.bezelStyle = .regularSquare
        button.isBordered = false
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
        button.contentTintColor = KernlTheme.muted
        button.toolTip = label
        button.setAccessibilityLabel(label)
        button.target = self
        button.action = action
        button.translatesAutoresizingMaskIntoConstraints = false
        button.widthAnchor.constraint(equalToConstant: 28).isActive = true
        button.heightAnchor.constraint(equalToConstant: 28).isActive = true
    }

    private func configure(_ button: NSButton, symbol: String, label: String, action: Selector) {
        button.bezelStyle = .regularSquare
        button.isBordered = false
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 14, weight: .semibold)
        button.contentTintColor = KernlTheme.ink
        button.setAccessibilityLabel(label)
        button.toolTip = label
        button.target = self
        button.action = action
        button.translatesAutoresizingMaskIntoConstraints = false
        button.widthAnchor.constraint(equalToConstant: 32).isActive = true
        button.heightAnchor.constraint(equalToConstant: 32).isActive = true
        button.wantsLayer = true
        button.layer?.cornerRadius = 16
        button.layer?.backgroundColor = KernlTheme.soft.cgColor
    }

    // MARK: Public

    /// Starts a new read-along for `text`.
    func show(text: String, status textStatus: String) {
        hideWork?.cancel()
        timeline = ReadAlongTimeline(text)
        lines = timeline.lines(maxWords: 12)
        currentWord = -1
        transport.isHidden = false
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
        transport.isHidden = true
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
        // Start at the sentence being read and fill the box with what follows.
        let lineIndex = lines.firstIndex { $0.contains(word) } ?? 0
        let start = lines.isEmpty ? 0 : lines[lineIndex].lowerBound
        let lineRange = start..<min(timeline.words.count, start + 400)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineHeightMultiple = 1.3
        paragraph.lineBreakMode = .byWordWrapping
        let output = NSMutableAttributedString()
        for index in lineRange {
            let isCurrent = spoken && index == word
            let isSpoken = spoken && index < word
            let attributes: [NSAttributedString.Key: Any] = [
                .font: Type.sans(textSize, isCurrent ? .semibold : .regular),
                .foregroundColor: isCurrent ? KernlTheme.accent : (isSpoken ? KernlTheme.ink : KernlTheme.muted),
                .paragraphStyle: paragraph
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
        if let placedFrame {
            setFrame(placedFrame, display: true)
        } else {
            setContentSize(expanded ? Self.expandedSize : Self.compactSize)
            position()
        }
        updateTextWidth()
        orderFrontRegardless()
    }

    private func updateTextWidth() {
        lineField.preferredMaxLayoutWidth = max(200, frame.width - 36)
    }

    @objc private func resized() {
        if isVisible { placedFrame = frame }
        updateTextWidth()
        let word = currentWord
        currentWord = -2
        if !timeline.words.isEmpty { render(word: max(0, word), spoken: word >= 0) }
    }

    @objc private func moved() {
        if isVisible { placedFrame = frame }
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
        guard let screen else { return }
        // Clear of readr's bubble or writr's window if they are already open.
        setFrameOrigin(KernlPlacement.cornerOrigin(for: frame.size, on: screen))
    }

    private func setSpeedLabel(_ speed: Float) {
        let text = speed == Float(Int(speed)) ? "\(Int(speed))×" : "\(speed)×"
        speedButton.attributedTitle = NSAttributedString(string: text, attributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: KernlTheme.ink
        ])
        speedButton.setAccessibilityLabel("Speed \(text). Change speed")
    }

    @objc private func speedTapped() {
        if let speed = onSpeed?() { setSpeedLabel(speed) }
    }

    @objc private func pauseTapped() { onPause?() }
    @objc private func settingsTapped() { onSettings?() }

    @objc private func muteTapped() {
        let muted = onMute?() ?? false
        muteButton.image = NSImage(systemSymbolName: muted ? "speaker.slash" : "speaker.wave.2",
                                   accessibilityDescription: muted ? "Unmute" : "Mute")
        muteButton.contentTintColor = muted ? KernlTheme.accent : KernlTheme.muted
        muteButton.toolTip = muted ? "Unmute" : "Mute"
        muteButton.setAccessibilityLabel(muted ? "Unmute" : "Mute")
    }

    @objc private func closeTapped() {
        onStop?()
        hideWork?.cancel()
        ticker?.invalidate()
        orderOut(nil)
    }

    @objc private func expandTapped() {
        expanded.toggle()
        // Grow or shrink from the bottom-right corner the player sits in.
        let size = expanded ? Self.expandedSize : Self.compactSize
        let current = frame
        let target = NSRect(x: current.maxX - size.width, y: current.minY, width: size.width, height: size.height)
        placedFrame = nil
        setFrame(target, display: true, animate: true)
        placedFrame = frame
        expandButton.image = NSImage(systemSymbolName: expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                                     accessibilityDescription: expanded ? "Smaller player" : "Bigger player")
        expandButton.toolTip = expanded ? "Smaller player" : "Bigger player"
        let word = currentWord
        currentWord = -2
        render(word: max(0, word), spoken: word >= 0)
    }
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
