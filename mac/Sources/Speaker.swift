import Foundation
import AVFoundation

/// Desktop listnr speaks through the same local voice server as the Chrome
/// reader, and the same way: one sentence-sized piece at a time. The first
/// piece plays in about two seconds and the next pieces are made while it
/// plays, so long pages never hit a length limit or a timeout. If the server
/// is unavailable, the rest of the read uses a US English macOS voice.
final class Speaker: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    enum State { case preparing, speaking, paused, finished }
    /// Where playback is, for the read-along player.
    enum Progress {
        /// Server audio: the character being spoken, seconds played and the
        /// estimated length of the whole read, both at the chosen speed.
        case audio(character: Int, elapsed: Double, total: Double)
        /// macOS voice: the exact character being spoken.
        case character(Int)
    }
    var onState: ((State) -> Void)?

    static let speeds: [Float] = [1, 1.25, 1.5, 2, 0.75]
    /// How many pieces to have ready ahead of the one playing.
    private static let lookahead = 2

    private let synth = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var generation = UUID()
    private var text = ""
    private var chunks: [NSRange] = []
    private var audio: [Int: Data] = [:]
    private var durations: [Int: Double] = [:]
    private var tasks: [Int: URLSessionDataTask] = [:]
    private var playing = -1
    private var paused = false
    private var waitingFor: Int?
    private var systemOffset = 0
    private var spokenLocation = 0

    override init() {
        super.init()
        synth.delegate = self
    }

    // MARK: Speed

    /// Playback speed, remembered between reads.
    var rate: Float {
        get {
            let stored = UserDefaults.standard.float(forKey: "listnr.desktop.rate")
            return Self.speeds.contains(stored) ? stored : 1
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "listnr.desktop.rate")
            player?.rate = newValue
        }
    }

    /// Moves to the next speed and returns it.
    @discardableResult
    func cycleRate() -> Float {
        let index = Self.speeds.firstIndex(of: rate) ?? 0
        rate = Self.speeds[(index + 1) % Self.speeds.count]
        return rate
    }

    // MARK: State

    /// True from the moment a read starts until it finishes or stops.
    var isActive: Bool { !chunks.isEmpty || synth.isSpeaking }

    var progress: Progress? {
        if synth.isSpeaking { return .character(systemOffset + spokenLocation) }
        guard chunks.indices.contains(playing) else { return nil }
        let speed = Double(max(rate, 0.1))
        let chunk = chunks[playing]
        var fraction = 0.0
        var current = 0.0
        if let player, player.duration > 0 {
            current = player.currentTime
            fraction = current / player.duration
        }
        // Inside a piece, time each word by its length and the pause after it.
        let piece = ReadAlongTimeline((text as NSString).substring(with: chunk))
        let word = piece.wordIndex(atFraction: fraction)
        let character = chunk.location + (piece.words.indices.contains(word) ? piece.words[word].range.location : 0)
        let done = (0..<playing).reduce(0.0) { $0 + (durations[$1] ?? 0) }
        return .audio(character: character, elapsed: (done + current) / speed, total: estimatedTotal() / speed)
    }

    /// Known piece lengths, scaled up to the whole text by character count.
    private func estimatedTotal() -> Double {
        let known = durations.keys.sorted()
        let seconds = known.reduce(0.0) { $0 + (durations[$1] ?? 0) }
        let characters = known.reduce(0) { $0 + chunks[$1].length }
        guard characters > 0 else { return 0 }
        let all = chunks.reduce(0) { $0 + $1.length }
        return seconds / Double(characters) * Double(all)
    }

    // MARK: Control

    func speak(_ input: String) {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        reset()
        text = trimmed
        chunks = SpeechChunker.chunks(trimmed)
        guard !chunks.isEmpty else { return }
        onState?(.preparing)
        fetchAhead(from: 0)
        play(0)
    }

    func togglePause() {
        if synth.isSpeaking || synth.isPaused {
            if synth.isPaused {
                synth.continueSpeaking()
                onState?(.speaking)
            } else {
                synth.pauseSpeaking(at: .immediate)
                onState?(.paused)
            }
            return
        }
        guard !chunks.isEmpty else { return }
        paused.toggle()
        if paused {
            player?.pause()
            onState?(.paused)
        } else {
            if let player { player.play() } else if let waitingFor { play(waitingFor) }
            onState?(.speaking)
        }
    }

    func stop() {
        reset()
        onState?(.finished)
    }

    private func reset() {
        generation = UUID()
        tasks.values.forEach { $0.cancel() }
        tasks = [:]
        audio = [:]
        durations = [:]
        chunks = []
        text = ""
        playing = -1
        paused = false
        waitingFor = nil
        player?.stop()
        player = nil
        systemOffset = 0
        spokenLocation = 0
        synth.stopSpeaking(at: .immediate)
    }

    // MARK: Pieces

    private func fetchAhead(from index: Int) {
        guard index < chunks.count else { return }
        for next in index...min(chunks.count - 1, index + Self.lookahead)
        where audio[next] == nil && tasks[next] == nil && durations[next] == nil {
            fetch(next)
        }
    }

    private func fetch(_ index: Int) {
        let token = generation
        let piece = (text as NSString).substring(with: chunks[index])
        var request = URLRequest(url: ListnrVoiceCatalog.serverURL.appendingPathComponent("api/tts/speak"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "text": piece, "voice": ListnrPreferences.shared.voiceID
        ])
        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
            DispatchQueue.main.async {
                guard let self, self.generation == token else { return }
                self.tasks[index] = nil
                if ok, let data, !data.isEmpty {
                    self.audio[index] = data
                    if self.waitingFor == index, !self.paused { self.play(index) }
                } else {
                    self.fallBack(from: index)
                }
            }
        }
        tasks[index] = task
        task.resume()
    }

    private func play(_ index: Int) {
        guard chunks.indices.contains(index) else { return finish() }
        guard let data = audio[index] else {
            waitingFor = index
            return
        }
        waitingFor = nil
        do {
            let player = try AVAudioPlayer(data: data)
            player.delegate = self
            player.enableRate = true
            player.rate = rate
            player.prepareToPlay()
            durations[index] = player.duration
            self.player = player
            playing = index
            audio[index] = nil
            fetchAhead(from: index + 1)
            if paused { return }
            if player.play() { onState?(.speaking) } else { fallBack(from: index) }
        } catch {
            fallBack(from: index)
        }
    }

    private func finish() {
        reset()
        onState?(.finished)
    }

    /// The server could not make a piece: read the rest with the macOS voice.
    private func fallBack(from index: Int) {
        guard chunks.indices.contains(index) else { return finish() }
        let start = chunks[index].location
        let rest = (text as NSString).substring(from: start)
        tasks.values.forEach { $0.cancel() }
        tasks = [:]
        player?.stop()
        player = nil
        chunks = []
        systemOffset = start
        spokenLocation = 0
        let voices = AVSpeechSynthesisVoice.speechVoices()
        let preferred = voices.first {
            $0.language == "en-US" && $0.name.lowercased().contains("samantha")
        } ?? voices.first { $0.language == "en-US" }
        let utterance = AVSpeechUtterance(string: rest)
        utterance.voice = preferred
        utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, 0.5 * rate)
        synth.speak(utterance)
        onState?(.speaking)
    }

    // MARK: Delegates

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === self.player else { return }
        self.player = nil
        play(playing + 1)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                           willSpeakRangeOfSpeechString characterRange: NSRange,
                           utterance: AVSpeechUtterance) {
        spokenLocation = characterRange.location
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        systemOffset = 0
        onState?(.finished)
    }
}
