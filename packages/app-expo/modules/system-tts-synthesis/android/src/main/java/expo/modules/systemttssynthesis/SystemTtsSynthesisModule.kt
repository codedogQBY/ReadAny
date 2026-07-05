package expo.modules.systemttssynthesis

import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.UUID

class SystemTtsSynthesisModule : Module() {
  private data class SynthesisOptions(
    val rate: Double? = null,
    val pitch: Double? = null,
    val language: String? = null,
    val voice: String? = null,
  )

  private data class PendingRequest(
    val text: String,
    val options: SynthesisOptions,
    val promise: Promise,
  )

  private val pendingRequests = ArrayDeque<PendingRequest>()
  private val pendingPromises = mutableMapOf<String, Promise>()
  private var tts: TextToSpeech? = null
  private var ready = false
  private var failedInit = false

  override fun definition() = ModuleDefinition {
    Name("SystemTtsSynthesis")

    OnCreate {
      ensureTts()
    }

    OnDestroy {
      pendingRequests.clear()
      pendingPromises.clear()
      tts?.shutdown()
      tts = null
      ready = false
    }

    AsyncFunction("synthesizeToFile") { text: String, options: SynthesisOptions, promise: Promise ->
      if (text.isBlank()) {
        promise.reject(CodedException("Text is empty"))
        return@AsyncFunction
      }
      if (text.length > TextToSpeech.getMaxSpeechInputLength()) {
        promise.reject(CodedException("Text exceeds Android TextToSpeech input limit"))
        return@AsyncFunction
      }
      if (failedInit) {
        promise.reject(CodedException("Android TextToSpeech is unavailable"))
        return@AsyncFunction
      }

      ensureTts()
      val request = PendingRequest(text, options, promise)
      if (!ready) {
        pendingRequests.add(request)
        return@AsyncFunction
      }
      synthesize(request)
    }
  }

  private fun ensureTts() {
    if (tts != null || failedInit) return
    tts = TextToSpeech(appContext.reactContext) { status ->
      if (status != TextToSpeech.SUCCESS) {
        failedInit = true
        val error = CodedException("Android TextToSpeech initialization failed: $status")
        while (pendingRequests.isNotEmpty()) {
          pendingRequests.removeFirst().promise.reject(error)
        }
        return@TextToSpeech
      }

      ready = true
      failedInit = false
      tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String) = Unit

        override fun onDone(utteranceId: String) {
          val promise = pendingPromises.remove(utteranceId) ?: return
          promise.resolve(utteranceId)
        }

        override fun onStop(utteranceId: String, interrupted: Boolean) {
          val promise = pendingPromises.remove(utteranceId) ?: return
          promise.reject(CodedException("System TTS synthesis stopped"))
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String) {
          val promise = pendingPromises.remove(utteranceId) ?: return
          promise.reject(CodedException("System TTS synthesis failed"))
        }
      })

      flushPendingRequests()
    }
  }

  private fun flushPendingRequests() {
    while (pendingRequests.isNotEmpty()) {
      synthesize(pendingRequests.removeFirst())
    }
  }

  private fun synthesize(request: PendingRequest) {
    val engine = tts
    if (engine == null || !ready) {
      pendingRequests.add(request)
      return
    }

    try {
      applyOptions(engine, request.options)
      val cacheDir = requireNotNull(appContext.reactContext?.cacheDir)
      val file = File(cacheDir, "readany-system-tts-${UUID.randomUUID()}.wav")
      val fileUri = file.toURI().toString()
      pendingPromises[fileUri] = request.promise

      val result = engine.synthesizeToFile(request.text, Bundle(), file, fileUri)
      if (result != TextToSpeech.SUCCESS) {
        pendingPromises.remove(fileUri)
        request.promise.reject(CodedException("TextToSpeech.synthesizeToFile failed: $result"))
      }
    } catch (error: Exception) {
      request.promise.reject(CodedException(error.message ?: "System TTS synthesis failed"))
    }
  }

  private fun applyOptions(engine: TextToSpeech, options: SynthesisOptions) {
    options.rate?.let { engine.setSpeechRate(it.toFloat()) }
    options.pitch?.let { engine.setPitch(it.toFloat()) }

    options.language?.let { language ->
      val locale = Locale.forLanguageTag(language)
      val result = engine.isLanguageAvailable(locale)
      if (result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED) {
        engine.language = locale
      }
    }

    options.voice?.let { voiceName ->
      val voice = engine.voices?.firstOrNull { it.name == voiceName }
      if (voice != null) engine.voice = voice
    }
  }
}
