import Foundation
import AVFoundation

/// Desktop Listnr speaks through the same local server as the Chrome reader.
/// If that server is down it falls back to a US female macOS voice, never the
/// old British system voice.
final class Speaker: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    enum State { case speaking, paused, finished }
    var onState: ((State) -> Void)?

    private let synth = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var request: URLSessionDataTask?
    private var generation = UUID()

    override init() {
        super.init()
        synth.delegate = self
    }

    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        stopPlayback()
        lastRequestedText = trimmed
        let token = UUID()
        generation = token
        onState?(.speaking)

        let voice = ListnrPreferences.shared.voiceID
        var request = URLRequest(url: ListnrVoiceCatalog.serverURL.appendingPathComponent("api/tts/speak"))
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["text": trimmed, "voice": voice])

        self.request = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self, self.generation == token else { return }
            if let http = response as? HTTPURLResponse,
               (200..<300).contains(http.statusCode),
               let data, !data.isEmpty {
                DispatchQueue.main.async {
                    guard self.generation == token else { return }
                    self.play(data)
                }
            } else {
                DispatchQueue.main.async {
                    guard self.generation == token else { return }
                    self.speakSystem(trimmed)
                }
            }
        }
        self.request?.resume()
    }

    func togglePause() {
        if let player {
            if player.isPlaying {
                player.pause()
                onState?(.paused)
            } else {
                player.play()
                onState?(.speaking)
            }
            return
        }
        if synth.isPaused {
            synth.continueSpeaking()
            onState?(.speaking)
        } else if synth.isSpeaking {
            synth.pauseSpeaking(at: .immediate)
            onState?(.paused)
        }
    }

    func stop() {
        generation = UUID()
        request?.cancel()
        request = nil
        player?.stop()
        player = nil
        synth.stopSpeaking(at: .immediate)
        onState?(.finished)
    }

    private func stopPlayback() {
        request?.cancel()
        request = nil
        player?.stop()
        player = nil
        synth.stopSpeaking(at: .immediate)
    }

    private func play(_ data: Data) {
        do {
            let player = try AVAudioPlayer(data: data)
            player.delegate = self
            player.prepareToPlay()
            self.player = player
            if !player.play() { speakSystemFallback() }
        } catch {
            speakSystemFallback()
        }
    }

    private func speakSystemFallback() {
        let text = lastRequestedText
        guard !text.isEmpty else {
            onState?(.finished)
            return
        }
        speakSystem(text)
    }

    private var lastRequestedText = ""

    private func speakSystem(_ text: String) {
        lastRequestedText = text
        let voices = AVSpeechSynthesisVoice.speechVoices()
        let preferred = voices.first {
            $0.language == "en-US" && $0.name.lowercased().contains("samantha")
        } ?? voices.first { $0.language == "en-US" }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = preferred
        utterance.rate = 0.5
        synth.speak(utterance)
        onState?(.speaking)
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        self.player = nil
        onState?(.finished)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        onState?(.finished)
    }
}
