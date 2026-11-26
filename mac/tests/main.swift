import Foundation

var failures = 0
func check(_ ok: Bool, _ name: String) { print(ok ? "pass  \(name)" : "FAIL  \(name)"); if !ok { failures += 1 } }

let text = "Hello there, this is listnr. It reads the page aloud and highlights each word as it goes."
let line = ReadAlongTimeline(text)
check(line.words.count == 17, "splits into words")
check(line.words.first?.text == "Hello" && line.words.last?.text == "goes.", "keeps punctuation on words")
check(line.wordIndex(atFraction: 0) == 0, "start is the first word")
check(line.wordIndex(atFraction: 1) == 16, "end is the last word")
check(line.wordIndex(atFraction: 0.5) > 5 && line.wordIndex(atFraction: 0.5) < 12, "middle is mid text")
check(line.wordIndex(atFraction: 0.3) <= line.wordIndex(atFraction: 0.6), "moves forward")
check(line.wordIndex(atCharacter: (text as NSString).range(of: "page").location) == 8, "exact character maps to its word")

// Lines break at sentence ends and never exceed the word cap.
let lines = line.lines(maxWords: 8)
check(lines.first.map { line.words[$0.upperBound - 1].text } == "listnr.", "first line ends at the sentence")
check(lines.allSatisfy { $0.count <= 8 }, "no line passes the cap")
check(lines.map(\.count).reduce(0, +) == 17, "lines cover every word once")
check(line.lineIndex(forWord: 16, maxWords: 8) == lines.count - 1, "last word sits in the last line")

check(ReadAlongTimeline("").words.isEmpty, "empty text has no words")
check(ReadAlongTimeline.clock(75) == "1:15" && ReadAlongTimeline.clock(5) == "0:05", "clock format")

// Sentence chunks for streaming synthesis.
let long = String(repeating: "This is a sentence about logs and traces. ", count: 40) + "And a final, much longer sentence that keeps going with clause after clause, so that it has to be split somewhere sensible rather than sent whole to the voice server."
let chunks = SpeechChunker.chunks(long)
let ns = long as NSString
check(!chunks.isEmpty, "long text makes chunks")
check(chunks.allSatisfy { $0.length <= SpeechChunker.maxLength }, "no chunk passes the cap")
check(chunks.first?.location == 0, "chunks start at the beginning")
check(zip(chunks, chunks.dropFirst()).allSatisfy { $0.location + $0.length <= $1.location }, "chunks are ordered and do not overlap")
let covered = chunks.map { ns.substring(with: $0) }.joined(separator: " ")
check(covered.split(separator: " ").count == long.split(separator: " ").count, "chunks keep every word")
check(ns.substring(with: chunks[0]).hasSuffix("."), "a chunk ends on a sentence when it can")
check(SpeechChunker.chunks("   ").isEmpty, "blank text has no chunks")
check(SpeechChunker.chunks("Short one.").count == 1, "short text is one chunk")

if failures > 0 { print("\(failures) failed"); exit(1) }
print("all passed")
