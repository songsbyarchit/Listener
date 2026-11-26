import Foundation

/// Splits what listnr is reading into words, estimates when each word is spoken
/// and groups words into short lines for the read-along player.
///
/// The local voice server returns audio without word timings, so timing is
/// estimated: each word weighs its length, and punctuation adds the pause a
/// voice takes after it. Mapped against the real playback position this keeps
/// the highlight within a word or so of the voice.
struct ReadAlongTimeline {
    struct Word {
        let text: String
        let range: NSRange
        let weight: Double
    }

    let words: [Word]
    private let cumulative: [Double]
    private let total: Double

    init(_ text: String) {
        var words: [Word] = []
        let ns = text as NSString
        let regex = try? NSRegularExpression(pattern: "\\S+")
        for match in regex?.matches(in: text, range: NSRange(location: 0, length: ns.length)) ?? [] {
            let word = ns.substring(with: match.range)
            var weight = Double(word.count) + 2
            if let last = word.last {
                if ".!?".contains(last) { weight += 8 }
                else if ",;:".contains(last) { weight += 4 }
            }
            words.append(Word(text: word, range: match.range, weight: weight))
        }
        self.words = words
        var running = 0.0
        cumulative = words.map { running += $0.weight; return running }
        total = running
    }

    /// The word being spoken at this share of the audio, from 0 to 1.
    func wordIndex(atFraction fraction: Double) -> Int {
        guard !words.isEmpty else { return 0 }
        let target = max(0, min(1, fraction)) * total
        let index = cumulative.firstIndex { $0 >= target } ?? words.count - 1
        return min(index, words.count - 1)
    }

    /// The word containing this character offset, for voices that report ranges.
    func wordIndex(atCharacter location: Int) -> Int {
        guard !words.isEmpty else { return 0 }
        return words.lastIndex { $0.range.location <= location } ?? 0
    }

    /// Word ranges for display lines: each sentence is one line, long sentences
    /// are split into even parts of at most `maxWords`.
    func lines(maxWords: Int = 12) -> [Range<Int>] {
        var lines: [Range<Int>] = []
        var start = 0
        for (index, word) in words.enumerated() {
            let endsSentence = word.text.last.map { ".!?".contains($0) } ?? false
            if endsSentence || index == words.count - 1 {
                let count = index + 1 - start
                let parts = Int(ceil(Double(count) / Double(maxWords)))
                let size = Int(ceil(Double(count) / Double(parts)))
                var cursor = start
                while cursor <= index {
                    let end = min(index + 1, cursor + size)
                    lines.append(cursor..<end)
                    cursor = end
                }
                start = index + 1
            }
        }
        return lines
    }

    func lineIndex(forWord word: Int, maxWords: Int = 12) -> Int {
        lines(maxWords: maxWords).firstIndex { $0.contains(word) } ?? 0
    }

    static func clock(_ seconds: Double) -> String {
        let value = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}

/// Cuts text into sentence-sized pieces for the voice server, the way the
/// Chrome reader does. The first piece is ready in about two seconds, so
/// playback starts quickly, and there is no upper limit on how much is read.
enum SpeechChunker {
    static let targetLength = 260
    static let maxLength = 400

    static func chunks(_ text: String) -> [NSRange] {
        let ns = text as NSString
        var sentences: [NSRange] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: .bySentences) { _, range, _, _ in
            let trimmed = trim(range, in: ns)
            if trimmed.length > 0 { sentences.append(contentsOf: split(trimmed, in: ns)) }
        }
        // Merge short sentences up to the target so the voice keeps its flow.
        var chunks: [NSRange] = []
        for sentence in sentences {
            if let last = chunks.last,
               sentence.location + sentence.length - last.location <= targetLength {
                chunks[chunks.count - 1] = NSRange(location: last.location,
                                                   length: sentence.location + sentence.length - last.location)
            } else {
                chunks.append(sentence)
            }
        }
        return chunks
    }

    /// Splits an overlong sentence at a comma or a space, never mid-word.
    private static func split(_ range: NSRange, in ns: NSString) -> [NSRange] {
        guard range.length > maxLength else { return [range] }
        var parts: [NSRange] = []
        var start = range.location
        let end = range.location + range.length
        while end - start > maxLength {
            let window = NSRange(location: start, length: maxLength)
            var cut = ns.range(of: ", ", options: .backwards, range: window).location
            if cut == NSNotFound || cut - start < maxLength / 3 {
                cut = ns.range(of: " ", options: .backwards, range: window).location
            }
            if cut == NSNotFound || cut <= start { cut = start + maxLength } else { cut += 1 }
            let piece = trim(NSRange(location: start, length: cut - start), in: ns)
            if piece.length > 0 { parts.append(piece) }
            start = cut
        }
        let rest = trim(NSRange(location: start, length: end - start), in: ns)
        if rest.length > 0 { parts.append(rest) }
        return parts
    }

    private static func trim(_ range: NSRange, in ns: NSString) -> NSRange {
        var start = range.location
        var end = range.location + range.length
        let space = CharacterSet.whitespacesAndNewlines
        while start < end, let scalar = UnicodeScalar(ns.character(at: start)), space.contains(scalar) { start += 1 }
        while end > start, let scalar = UnicodeScalar(ns.character(at: end - 1)), space.contains(scalar) { end -= 1 }
        return NSRange(location: start, length: end - start)
    }
}
