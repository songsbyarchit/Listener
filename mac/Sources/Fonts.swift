import Foundation
import AppKit
import CoreText

/// Registers the bundled typefaces (Instrument Sans, Instrument Serif,
/// Fragment Mono) with the process. Info.plist also declares the fonts folder,
/// but registering explicitly makes `--check` and early UI construction safe.
enum FontRegistrar {
    private static var didRegister = false

    static func register() {
        guard !didRegister else { return }
        didRegister = true
        let folders = [
            Bundle.main.resourceURL?.appendingPathComponent("Fonts"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("Resources/Fonts")
        ]
        for folder in folders.compactMap({ $0 }) {
            let urls = (try? FileManager.default.contentsOfDirectory(
                at: folder,
                includingPropertiesForKeys: nil
            )) ?? []
            for url in urls where url.pathExtension.lowercased() == "ttf" {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }
}

/// The house typeface set. Instrument Sans does almost all the work; the serif
/// italic is the raised eyebrow; Fragment Mono carries labels and numbers.
enum Type {
    enum Weight {
        case regular, medium, semibold, bold
    }

    /// The shared text size from ~/.fleet/textsize, applied to every font.
    static var scale: CGFloat = 1

    static func sans(_ size: CGFloat, _ weight: Weight = .regular) -> NSFont {
        let size = scale == 1 ? size : (size * scale).rounded()
        let name: String
        switch weight {
        case .medium: name = "InstrumentSans-Regular_Medium"
        case .semibold: name = "InstrumentSans-Regular_SemiBold"
        case .bold: name = "InstrumentSans-Regular_Bold"
        default: name = "InstrumentSans-Regular"
        }
        if let font = NSFont(name: name, size: size) { return font }
        return NSFont.systemFont(ofSize: size, weight: systemWeight(weight))
    }

    static func serifItalic(_ size: CGFloat) -> NSFont {
        NSFont(name: "InstrumentSerif-Italic", size: size)
            ?? NSFont.systemFont(ofSize: size, weight: .regular)
    }

    static func serif(_ size: CGFloat) -> NSFont {
        NSFont(name: "InstrumentSerif-Regular", size: size)
            ?? NSFont.systemFont(ofSize: size, weight: .regular)
    }

    private static func systemWeight(_ weight: Weight) -> NSFont.Weight {
        switch weight {
        case .medium: return .medium
        case .semibold: return .semibold
        case .bold: return .bold
        default: return .regular
        }
    }
}

// MARK: - Attributed text

func houseAttributed(_ text: String,
                     font: NSFont,
                     color: NSColor,
                     trackingEm: CGFloat = 0,
                     alignment: NSTextAlignment = .left,
                     lineSpacing: CGFloat = 0) -> NSAttributedString {
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byWordWrapping
    style.alignment = alignment
    style.lineSpacing = lineSpacing
    var attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: style
    ]
    if trackingEm != 0 {
        attributes[.kern] = trackingEm * font.pointSize
    }
    return NSAttributedString(string: text, attributes: attributes)
}

/// A sentence with one phrase set in Instrument Serif italic, at the same
/// optical size. The house signature move.
func emphasizedText(_ text: String,
                    emphasis: String,
                    size: CGFloat,
                    color: NSColor,
                    weight: Type.Weight = .regular,
                    trackingEm: CGFloat = -0.01,
                    lineSpacing: CGFloat = 0) -> NSAttributedString {
    let result = NSMutableAttributedString(
        attributedString: houseAttributed(
            text,
            font: Type.sans(size, weight),
            color: color,
            trackingEm: trackingEm,
            lineSpacing: lineSpacing
        )
    )
    let full = text as NSString
    let ranges = rangesOfEmphasis(in: full, emphasis: emphasis)
    for range in ranges {
        result.addAttributes(
            [.font: Type.serifItalic(size * 1.06)],
            range: range
        )
    }
    return result
}

private func rangesOfEmphasis(in text: NSString, emphasis: String) -> [NSRange] {
    guard !emphasis.isEmpty else { return [] }
    var ranges: [NSRange] = []
    var searchRange = NSRange(location: 0, length: text.length)
    while true {
        let found = text.range(of: emphasis, options: [], range: searchRange)
        guard found.location != NSNotFound else { break }
        ranges.append(found)
        let next = found.location + max(1, found.length)
        searchRange = NSRange(location: next, length: text.length - next)
    }
    return ranges
}
