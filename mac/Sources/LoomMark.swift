import AppKit

/// The small in-app mark. Same black tile and cream glyph as the app icon,
/// drawn small enough to sit beside a lowercase name.
enum LoomAppMark {
    case speekr
    case listnr
    case writr
    case readr
}

final class LoomMarkView: NSView {
    private let kind: LoomAppMark
    private let size: CGFloat
    private let paper = NSColor(srgbRed: 0.984, green: 0.914, blue: 0.808, alpha: 1)
    private var base: NSColor {
        switch kind {
        case .speekr: return NSColor(srgbRed: 0.290, green: 0.090, blue: 0.282, alpha: 1)
        case .listnr: return NSColor(srgbRed: 0.027, green: 0.212, blue: 0.173, alpha: 1)
        case .writr: return NSColor(srgbRed: 0.012, green: 0.227, blue: 0.290, alpha: 1)
        case .readr: return NSColor(srgbRed: 0.290, green: 0.063, blue: 0.161, alpha: 1)
        }
    }
    private var accent: NSColor {
        switch kind {
        case .speekr: return NSColor(srgbRed: 0.910, green: 0.365, blue: 0.541, alpha: 1)
        case .listnr: return NSColor(srgbRed: 0.545, green: 0.765, blue: 0.290, alpha: 1)
        case .writr: return NSColor(srgbRed: 0.125, green: 0.718, blue: 0.745, alpha: 1)
        case .readr: return NSColor(srgbRed: 0.953, green: 0.447, blue: 0.078, alpha: 1)
        }
    }

    init(kind: LoomAppMark, size: CGFloat = 30) {
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
        let s = min(bounds.width, bounds.height)
        guard s > 2 else { return }
        let unit = s / 30

        func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> NSRect {
            NSRect(x: x * unit, y: y * unit, width: w * unit, height: h * unit)
                .insetBy(dx: 0, dy: 0)
        }
        func path(_ rect: NSRect, _ radius: CGFloat) -> NSBezierPath {
            NSBezierPath(roundedRect: rect, xRadius: radius * unit, yRadius: radius * unit)
        }

        let tile = path(NSRect(x: 0.5 * unit, y: 0.5 * unit, width: 29 * unit, height: 29 * unit), 8)
        base.setFill()
        tile.fill()
        paper.withAlphaComponent(0.14).setStroke()
        tile.lineWidth = max(0.5, 0.6 * unit)
        tile.stroke()

        func fill(_ path: NSBezierPath, _ color: NSColor) {
            color.setFill()
            path.fill()
        }

        let letter: String
        switch kind {
        case .speekr: letter = "S"
        case .listnr: letter = "L"
        case .writr: letter = "W"
        case .readr: letter = "R"
        }
        let font = NSFont(name: "InstrumentSans-Regular_Bold", size: 17 * unit)
            ?? NSFont.systemFont(ofSize: 17 * unit, weight: .bold)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: paper
        ]
        let text = letter as NSString
        let textSize = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: (s - textSize.width) / 2,
                              y: 2 * unit + max(0, (14 * unit - textSize.height) / 2)),
                  withAttributes: attributes)

        let heights: [CGFloat] = [2.2, 3.2, 4.4, 3.2, 2.2]
        let barWidth: CGFloat = 1.2
        let gap: CGFloat = 1.2
        let total = barWidth * CGFloat(heights.count) + gap * CGFloat(heights.count - 1)
        var x = (s - total) / 2
        for (index, height) in heights.enumerated() {
            let bar = NSBezierPath(roundedRect: NSRect(x: x, y: 23.2 * unit,
                                                       width: barWidth * unit,
                                                       height: height * unit),
                                   xRadius: barWidth * unit / 2,
                                   yRadius: barWidth * unit / 2)
            (index == 2 ? accent : paper).setFill()
            bar.fill()
            x += (barWidth + gap) * unit
        }
    }
}
