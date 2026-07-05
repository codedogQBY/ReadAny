import AVFoundation
import ExpoModulesCore

private struct SynthesisOptions: Record {
  @Field
  var rate: Double?
  @Field
  var pitch: Double?
  @Field
  var language: String?
  @Field
  var voice: String?
}

private final class EmptyTextException: Exception {
  override var reason: String {
    "Text is empty"
  }
}

private final class InvalidVoiceException: GenericException<String> {
  override var reason: String {
    "Cannot find voice with identifier: \(param)"
  }
}

private final class SynthesisFailedException: GenericException<String> {
  override var reason: String {
    param
  }
}

public final class SystemTtsSynthesisModule: Module {
  private var activeSynthesizers: [String: AVSpeechSynthesizer] = [:]

  public func definition() -> ModuleDefinition {
    Name("SystemTtsSynthesis")

    OnDestroy {
      for synthesizer in activeSynthesizers.values {
        synthesizer.stopSpeaking(at: .immediate)
      }
      activeSynthesizers.removeAll()
    }

    AsyncFunction("synthesizeToFile") { (text: String, options: SynthesisOptions, promise: Promise) in
      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        promise.reject(EmptyTextException())
        return
      }

      let requestId = UUID().uuidString
      let outputURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("readany-system-tts-\(requestId)")
        .appendingPathExtension("caf")

      do {
        let utterance = try createUtterance(text: text, options: options)
        synthesizeUtterance(utterance, requestId: requestId, outputURL: outputURL, promise: promise)
      } catch {
        promise.reject(error)
      }
    }
  }

  private func createUtterance(text: String, options: SynthesisOptions) throws -> AVSpeechUtterance {
    let utterance = AVSpeechUtterance(string: text)

    if let language = options.language {
      utterance.voice = AVSpeechSynthesisVoice(language: language)
    }

    if let voice = options.voice {
      guard let synthesisVoice = AVSpeechSynthesisVoice(identifier: voice) else {
        throw InvalidVoiceException(voice)
      }
      utterance.voice = synthesisVoice
    }

    if let pitch = options.pitch {
      utterance.pitchMultiplier = Float(pitch)
    }

    if let rate = options.rate {
      utterance.rate = Float(rate) * AVSpeechUtteranceDefaultSpeechRate
    }

    return utterance
  }

  private func synthesizeUtterance(
    _ utterance: AVSpeechUtterance,
    requestId: String,
    outputURL: URL,
    promise: Promise
  ) {
    let synthesizer = AVSpeechSynthesizer()
    var audioFile: AVAudioFile?
    var completed = false

    let finish: (Result<URL, Error>) -> Void = { [weak self] result in
      if completed {
        return
      }
      completed = true
      DispatchQueue.main.async {
        self?.activeSynthesizers.removeValue(forKey: requestId)
        switch result {
        case .success(let url):
          promise.resolve(url.absoluteString)
        case .failure(let error):
          try? FileManager.default.removeItem(at: outputURL)
          promise.reject(error)
        }
      }
    }

    DispatchQueue.main.async { [weak self] in
      self?.activeSynthesizers[requestId] = synthesizer
      synthesizer.write(utterance) { buffer in
        guard let pcmBuffer = buffer as? AVAudioPCMBuffer else {
          finish(.failure(SynthesisFailedException("Unexpected audio buffer type")))
          return
        }

        if pcmBuffer.frameLength == 0 {
          if audioFile == nil {
            finish(.failure(SynthesisFailedException("System TTS produced no audio")))
          } else {
            finish(.success(outputURL))
          }
          return
        }

        do {
          if audioFile == nil {
            audioFile = try AVAudioFile(
              forWriting: outputURL,
              settings: pcmBuffer.format.settings
            )
          }
          try audioFile?.write(from: pcmBuffer)
        } catch {
          finish(.failure(SynthesisFailedException(error.localizedDescription)))
        }
      }
    }
  }
}
