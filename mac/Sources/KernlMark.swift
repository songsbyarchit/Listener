import AppKit

/// The small in-app mark. Same black tile and cream glyph as the app icon,
/// drawn small enough to sit beside a lowercase name.
enum KernlAppMark {
    case kernl
    case speakr
    case listnr
    case writr
    case readr
}

final class KernlMarkView: NSView {
    private let kind: KernlAppMark
    private let size: CGFloat
    private let paper = NSColor(srgbRed: 0.984, green: 0.914, blue: 0.808, alpha: 1)
    private var base: NSColor {
        switch kind {
        case .kernl: return NSColor(srgbRed: 0.078, green: 0.078, blue: 0.082, alpha: 1)
        case .speakr: return NSColor(srgbRed: 0.290, green: 0.090, blue: 0.282, alpha: 1)
        case .listnr: return NSColor(srgbRed: 0.027, green: 0.212, blue: 0.173, alpha: 1)
        case .writr: return NSColor(srgbRed: 0.012, green: 0.227, blue: 0.290, alpha: 1)
        case .readr: return NSColor(srgbRed: 0.290, green: 0.063, blue: 0.161, alpha: 1)
        }
    }
    private var mid: NSColor {
        switch kind {
        case .kernl: return NSColor(white: 0.30, alpha: 1)
        case .speakr: return NSColor(srgbRed: 0.482, green: 0.169, blue: 0.388, alpha: 1)
        case .listnr: return NSColor(srgbRed: 0.180, green: 0.455, blue: 0.314, alpha: 1)
        case .writr: return NSColor(srgbRed: 0.055, green: 0.416, blue: 0.447, alpha: 1)
        case .readr: return NSColor(srgbRed: 0.604, green: 0.180, blue: 0.180, alpha: 1)
        }
    }

    init(kind: KernlAppMark, size: CGFloat = 30) {
        self.kind = kind
        self.size = size
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: size).isActive = true
        heightAnchor.constraint(equalToConstant: size).isActive = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if let url = Bundle.main.url(forResource: "Mark", withExtension: "png"),
           let image = NSImage(contentsOf: url) {
            image.draw(in: bounds, from: .zero, operation: .sourceOver,
                       fraction: 1, respectFlipped: true, hints: nil)
            return
        }
        let s = min(bounds.width, bounds.height)
        let tile = NSBezierPath(roundedRect: NSRect(x: 0.5, y: 0.5, width: s - 1, height: s - 1),
                                xRadius: s * 0.28, yRadius: s * 0.28)
        base.setFill()
        tile.fill()
        paper.withAlphaComponent(0.16).setStroke()
        tile.lineWidth = 0.6
        tile.stroke()
    }

}
