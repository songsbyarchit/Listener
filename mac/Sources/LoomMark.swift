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
    private var mid: NSColor {
        switch kind {
        case .speekr: return NSColor(srgbRed: 0.482, green: 0.169, blue: 0.388, alpha: 1)
        case .listnr: return NSColor(srgbRed: 0.180, green: 0.455, blue: 0.314, alpha: 1)
        case .writr: return NSColor(srgbRed: 0.055, green: 0.416, blue: 0.447, alpha: 1)
        case .readr: return NSColor(srgbRed: 0.604, green: 0.180, blue: 0.180, alpha: 1)
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
        NSGradient(starting: base, ending: mid)?.draw(in: tile, angle: -45)
        paper.withAlphaComponent(0.16).setStroke()
        tile.lineWidth = max(0.5, 0.6 * unit)
        tile.stroke()

        func fill(_ path: NSBezierPath, _ color: NSColor) {
            color.setFill()
            path.fill()
        }
        func stroke(_ path: NSBezierPath, _ color: NSColor, _ width: CGFloat) {
            color.setStroke()
            path.lineWidth = width * unit
            path.stroke()
        }

        switch kind {
        case .speekr:
            // Microphone: cream capsule, dark grille, arc and stand.
            fill(path(rect(11.5, 5.2, 7, 10.5, 3.5), 3.5), paper)
            for y in [7.2, 9.2, 11.2] as [CGFloat] {
                fill(path(rect(12.8, y, 4.4, 0.55, 0.28), 0.28), base)
            }
            let arc = NSBezierPath()
            arc.move(to: NSPoint(x: 8.8 * unit, y: 14.0 * unit))
            arc.curve(to: NSPoint(x: 21.2 * unit, y: 14.0 * unit),
                      controlPoint1: NSPoint(x: 9.6 * unit, y: 21.0 * unit),
                      controlPoint2: NSPoint(x: 20.4 * unit, y: 21.0 * unit))
            stroke(arc, paper, 1.2)
            fill(path(rect(14.6, 20.0, 0.8, 3.0, 0.4), 0.4), paper)
            fill(path(rect(12.6, 22.8, 5.0, 0.9, 0.45), 0.45), paper)

        case .listnr:
            // Headphones: cream band and two ear cups.
            let band = NSBezierPath()
            band.move(to: NSPoint(x: 7.6 * unit, y: 17.0 * unit))
            band.curve(to: NSPoint(x: 22.4 * unit, y: 17.0 * unit),
                       controlPoint1: NSPoint(x: 7.6 * unit, y: 6.8 * unit),
                       controlPoint2: NSPoint(x: 22.4 * unit, y: 6.8 * unit))
            stroke(band, paper, 1.8)
            fill(path(rect(6.6, 15.3, 4.4, 7.2, 2.2), 2.2), paper)
            fill(path(rect(19.0, 15.3, 4.4, 7.2, 2.2), 2.2), paper)
            fill(path(rect(8.0, 17.4, 1.6, 3.0, 0.8), 0.8), base)
            fill(path(rect(20.4, 17.4, 1.6, 3.0, 0.8), 0.8), base)

        case .writr:
            // Fountain pen nib: cream leaf, dark breather hole and slit.
            let nib = NSBezierPath()
            nib.move(to: NSPoint(x: 15 * unit, y: 4.0 * unit))
            nib.curve(to: NSPoint(x: 22.2 * unit, y: 12.1 * unit),
                      controlPoint1: NSPoint(x: 18.4 * unit, y: 5.2 * unit),
                      controlPoint2: NSPoint(x: 21.0 * unit, y: 9.0 * unit))
            nib.curve(to: NSPoint(x: 15 * unit, y: 25.8 * unit),
                      controlPoint1: NSPoint(x: 21.0 * unit, y: 17.6 * unit),
                      controlPoint2: NSPoint(x: 18.0 * unit, y: 22.8 * unit))
            nib.curve(to: NSPoint(x: 7.8 * unit, y: 12.1 * unit),
                      controlPoint1: NSPoint(x: 12.0 * unit, y: 22.8 * unit),
                      controlPoint2: NSPoint(x: 9.0 * unit, y: 17.6 * unit))
            nib.curve(to: NSPoint(x: 15 * unit, y: 4.0 * unit),
                      controlPoint1: NSPoint(x: 9.0 * unit, y: 9.0 * unit),
                      controlPoint2: NSPoint(x: 11.6 * unit, y: 5.2 * unit))
            nib.close()
            fill(nib, paper)
            let hole = NSBezierPath(ovalIn: rect(13.6, 11.0, 2.8, 2.8, 1.4))
            fill(hole, base)
            let slit = NSBezierPath()
            slit.move(to: NSPoint(x: 15 * unit, y: 13.8 * unit))
            slit.line(to: NSPoint(x: 15 * unit, y: 24.0 * unit))
            stroke(slit, base, 0.55)

        case .readr:
            // Open book: two cream pages with a dark spine.
            let left = NSBezierPath()
            left.move(to: NSPoint(x: 15 * unit, y: 9.0 * unit))
            left.line(to: NSPoint(x: 6.4 * unit, y: 6.2 * unit))
            left.line(to: NSPoint(x: 6.4 * unit, y: 22.0 * unit))
            left.line(to: NSPoint(x: 15 * unit, y: 25.0 * unit))
            left.close()
            let right = NSBezierPath()
            right.move(to: NSPoint(x: 15 * unit, y: 9.0 * unit))
            right.line(to: NSPoint(x: 23.6 * unit, y: 6.2 * unit))
            right.line(to: NSPoint(x: 23.6 * unit, y: 22.0 * unit))
            right.line(to: NSPoint(x: 15 * unit, y: 25.0 * unit))
            right.close()
            fill(left, paper)
            fill(right, paper)
            let spine = NSBezierPath()
            spine.move(to: NSPoint(x: 15 * unit, y: 8.8 * unit))
            spine.line(to: NSPoint(x: 15 * unit, y: 24.6 * unit))
            stroke(spine, base, 0.8)
        }
    }
}
