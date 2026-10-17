package expo.modules.systemttssynthesis

import android.os.Bundle
import android.content.Intent
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import androidx.core.os.bundleOf
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.Locale
import java.util.UUID

object SystemTtsPlaybackState {
  data class Snapshot(
    val state: String,
    val index: Int,
    val total: Int,
    val positionSeconds: Double,
    val durationSeconds: Double,
    val playing: Boolean,
    val speed: Float,
  )

  data class Metadata(
    val title: String,
    val artist: String,
    val album: String,
    val artworkUri: String? = null,
  )

  var playCommand: (() -> Unit)? = null
  var pauseCommand: (() -> Unit)? = null
  var resumeCommand: (() -> Unit)? = null
  var stopCommand: (() -> Unit)? = null
  var nextCommand: (() -> Unit)? = null
  var previousCommand: (() -> Unit)? = null
  var seekCommand: ((Double) -> Unit)? = null
  var nativeSeekCommand: ((Double) -> Boolean)? = null
  var notifier: ((Snapshot) -> Unit)? = null
  var metadataListener: ((Metadata) -> Unit)? = null
  var lastSnapshot: Snapshot? = null
  var metadata: Metadata = Metadata("ReadAny", "ReadAny", "ReadAny")
    set(value) {
      field = value
      metadataListener?.invoke(value)
    }
}

class SystemTtsSynthesisModule : Module() {
  private data class SynthesisOptions(
    @Field val rate: Double? = null,
    @Field val pitch: Double? = null,
    @Field val language: String? = null,
    @Field val voice: String? = null,
  ) : Record

  private data class PlaybackRequest(
    val segments: List<String>,
    val options: SynthesisOptions,
    val startIndex: Int,
    val promise: Promise,
  )

  private data class AudioSynthesisRequest(
    val file: File,
    val index: Int,
    val startWhenReady: Boolean,
  )

  private data class PendingRequest(
    val text: String,
    val options: SynthesisOptions,
    val promise: Promise,
  )

  private val pendingRequests = ArrayDeque<PendingRequest>()
  private val pendingPromises = mutableMapOf<String, Promise>()
  private val pendingVoicePromises = ArrayDeque<Promise>()
  private val pendingPlaybackRequests = ArrayDeque<PlaybackRequest>()
  private val audioSynthesisRequests = mutableMapOf<String, AudioSynthesisRequest>()
  private val utteranceIndexes = mutableMapOf<String, Int>()
  private var playbackSegments: List<String> = emptyList()
  private var playbackOptions: SynthesisOptions? = null
  private var playbackGeneration = 0
  private var utteranceGeneration = 0
  private var currentIndex = 0
  private var lastQueuedIndex = -1
  private var playbackPaused = false
  private var playbackStopped = true
  private var audioMode = false
  private var audioPlayer: MediaPlayer? = null
  private var audioCurrentFile: File? = null
  private var audioCurrentIndex = -1
  private var nextAudioFile: File? = null
  private var nextAudioIndex = -1
  private var segmentStartedAtMs = 0L
  private var segmentDurationsSeconds = mutableListOf<Double>()
  private val measuredSegmentIndexes = mutableSetOf<Int>()
  private var progressUpdateAtMs = 0L
  private var tts: TextToSpeech? = null
  private var ready = false
  private var failedInit = false

  private fun logVoiceRecords() {
    val voices = tts?.voices ?: return
    val summary = voices.joinToString("; ") { voice ->
      "${voice.name}|${voice.locale.toLanguageTag()}|${voice.quality}"
    }
    Log.i("SystemTtsSynthesis", "available voices: $summary")
  }

  override fun definition() = ModuleDefinition {
    Name("SystemTtsSynthesis")
    Events("SystemTtsPlayback")

    OnCreate {
      ensureTts()
      SystemTtsPlaybackState.playCommand = { resumePlayback() }
      SystemTtsPlaybackState.pauseCommand = ::pausePlayback
      SystemTtsPlaybackState.resumeCommand = ::resumePlayback
      SystemTtsPlaybackState.stopCommand = { stopPlaybackInternal(sendEvents = true) }
      SystemTtsPlaybackState.nextCommand = { sendPlaybackEvent(mapOf("type" to "next")) }
      SystemTtsPlaybackState.previousCommand = {
        sendPlaybackEvent(mapOf("type" to "previous"))
      }
      SystemTtsPlaybackState.seekCommand = { position ->
        sendPlaybackEvent(
          mapOf(
            "type" to "seek",
            "position" to position,
            "duration" to estimateChapterDuration(),
          ),
        )
      }
      SystemTtsPlaybackState.nativeSeekCommand = ::seekToPositionSeconds
    }

    OnDestroy {
      SystemTtsPlaybackState.playCommand = null
      SystemTtsPlaybackState.pauseCommand = null
      SystemTtsPlaybackState.resumeCommand = null
      SystemTtsPlaybackState.stopCommand = null
      SystemTtsPlaybackState.nextCommand = null
      SystemTtsPlaybackState.previousCommand = null
      SystemTtsPlaybackState.seekCommand = null
      SystemTtsPlaybackState.nativeSeekCommand = null
      SystemTtsPlaybackState.notifier = null
      SystemTtsPlaybackState.metadataListener = null
      pendingRequests.clear()
      pendingPromises.clear()
      pendingVoicePromises.clear()
      pendingPlaybackRequests.clear()
      stopPlaybackInternal(sendEvents = false)
      stopPlaybackService()
      tts?.shutdown()
      tts = null
      ready = false
    }

    AsyncFunction("getVoices") { promise: Promise ->
      if (failedInit) {
        promise.resolve(emptyList<Map<String, Any?>>())
        return@AsyncFunction
      }
      ensureTts()
      if (ready) {
        promise.resolve(getVoiceRecords())
      } else {
        pendingVoicePromises.add(promise)
      }
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

    AsyncFunction("speak") {
      segments: List<String>,
      options: SynthesisOptions,
      startIndex: Int,
      promise: Promise ->
      val cleanSegments = segments.filter { it.isNotBlank() }
      if (cleanSegments.isEmpty()) {
        promise.reject(CodedException("Text is empty"))
        return@AsyncFunction
      }
      if (cleanSegments.any { it.length > TextToSpeech.getMaxSpeechInputLength() }) {
        promise.reject(CodedException("A segment exceeds Android TextToSpeech input limit"))
        return@AsyncFunction
      }
      if (failedInit) {
        promise.reject(CodedException("Android TextToSpeech is unavailable"))
        return@AsyncFunction
      }

      val request = PlaybackRequest(
        cleanSegments,
        options,
        startIndex.coerceIn(0, cleanSegments.lastIndex),
        promise,
      )
      ensureTts()
      if (!ready) {
        pendingPlaybackRequests.add(request)
        return@AsyncFunction
      }
      startPlayback(request)
    }

    Function("pause") {
      pausePlayback()
    }

    Function("resume") {
      resumePlayback()
    }

    Function("stopPlayback") {
      stopPlaybackInternal(sendEvents = true)
    }

    Function("append") { segments: List<String> ->
      appendPlaybackSegments(segments)
    }

    Function("seekToChunk") { index: Int ->
      seekToChunk(index)
    }

    Function("setMetadata") { title: String, artist: String, album: String, artwork: String? ->
      SystemTtsPlaybackState.metadata = SystemTtsPlaybackState.Metadata(
        title.ifBlank { "ReadAny" },
        artist.ifBlank { "ReadAny" },
        album.ifBlank { "ReadAny" },
        artwork?.takeIf { it.isNotBlank() },
      )
    }

    Function("setPlaybackOptions") { options: SynthesisOptions ->
      val previousOptions = playbackOptions
      playbackOptions = SynthesisOptions(
        rate = options.rate ?: previousOptions?.rate,
        pitch = options.pitch ?: previousOptions?.pitch,
        language = options.language ?: previousOptions?.language,
        voice = options.voice ?: previousOptions?.voice,
      )
      if (audioMode) {
        updateAudioPlaybackParams()
        notifyPlaybackService(if (playbackPaused) "paused" else "playing")
        Log.i(
          "SystemTtsSynthesis",
          "audio playback params: rate=${playbackOptions?.rate} pitch=${playbackOptions?.pitch}",
        )
        return@Function
      }
      if (shouldUseAudioPlayback(options)) {
        startAudioPlayback(currentIndex)
        return@Function
      }
      val engine = tts
      if (engine != null) applyOptions(engine, options)
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
        while (pendingPlaybackRequests.isNotEmpty()) {
          pendingPlaybackRequests.removeFirst().promise.reject(error)
        }
        return@TextToSpeech
      }

      ready = true
      failedInit = false
      tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String) {
          val index = utteranceIndexes[utteranceId] ?: return
          currentIndex = index
          segmentStartedAtMs = SystemClock.elapsedRealtime()
          sendPlaybackEvent(
            mapOf(
              "type" to "chunk",
              "index" to index,
              "total" to playbackSegments.size,
              "position" to segmentDurationsSeconds.take(index).sum(),
              "duration" to estimateChapterDuration(),
            ),
          )
        }

        override fun onRangeStart(utteranceId: String, start: Int, end: Int, frame: Int) {
          if (utteranceId !in utteranceIndexes) return
          sendPlaybackEvent(
            mapOf(
              "type" to "range",
              "index" to (utteranceIndexes[utteranceId] ?: currentIndex),
              "start" to start,
              "end" to end,
            ),
          )
        }

        override fun onDone(utteranceId: String) {
          if (handlePlaybackDone(utteranceId)) return
          val audioRequest = audioSynthesisRequests.remove(utteranceId)
          if (audioRequest != null) {
            handleAudioSynthesisDone(audioRequest)
            return
          }
          val promise = pendingPromises.remove(utteranceId) ?: return
          promise.resolve(utteranceId)
        }

        override fun onStop(utteranceId: String, interrupted: Boolean) {
          if (utteranceId in utteranceIndexes) return
          if (audioSynthesisRequests.remove(utteranceId) != null) return
          val promise = pendingPromises.remove(utteranceId) ?: return
          promise.reject(CodedException("System TTS synthesis stopped"))
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String) {
          val audioRequest = audioSynthesisRequests.remove(utteranceId)
          if (audioRequest != null) {
            audioRequest.file.delete()
            if (audioRequest.startWhenReady) {
              playbackStopped = true
              sendStateEvent("stopped")
            }
            return
          }
          if (utteranceIndexes.remove(utteranceId) != null) {
            playbackStopped = true
            playbackPaused = false
            sendStateEvent("stopped")
            sendPlaybackEvent(
              mapOf(
                "type" to "error",
                "message" to "System TTS playback failed",
                "index" to currentIndex,
                "total" to playbackSegments.size,
              ),
            )
            return
          }
          val promise = pendingPromises.remove(utteranceId) ?: return
          promise.reject(CodedException("System TTS synthesis failed"))
        }
      })

      while (pendingVoicePromises.isNotEmpty()) {
        pendingVoicePromises.removeFirst().resolve(getVoiceRecords())
      }

      while (pendingPlaybackRequests.isNotEmpty()) {
        startPlayback(pendingPlaybackRequests.removeFirst())
      }

      logVoiceRecords()

      flushPendingRequests()
    }
  }

  private fun getVoiceRecords(): List<Map<String, Any?>> {
    return try {
      tts?.voices?.map { voice ->
        mapOf(
          "identifier" to voice.name,
          "name" to voice.name,
          "language" to voice.locale.toLanguageTag(),
          "quality" to if (voice.quality > Voice.QUALITY_NORMAL) "Enhanced" else "Default",
        )
      } ?: emptyList()
    } catch (_: Exception) {
      emptyList()
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

  private fun startPlayback(request: PlaybackRequest) {
    val engine = tts
    if (engine == null || !ready) {
      pendingPlaybackRequests.add(request)
      return
    }

    playbackGeneration += 1
    playbackSegments = request.segments
    playbackOptions = request.options
    currentIndex = request.startIndex
    lastQueuedIndex = -1
    playbackPaused = false
    playbackStopped = false
    segmentDurationsSeconds = MutableList(request.segments.size) { 0.0 }
    measuredSegmentIndexes.clear()
    initializeEstimatedDurationsBefore(request.startIndex + 1)
    if (shouldUseAudioPlayback(request.options)) {
      startAudioPlayback(request.startIndex)
    } else {
      applyOptions(engine, request.options)
      queueUtterancesFrom(request.startIndex)
    }
    startPlaybackService()
    sendStateEvent("playing")
    request.promise.resolve(request.startIndex)
  }

  private fun appendPlaybackSegments(segments: List<String>): Boolean {
    val cleanSegments = segments.filter { it.isNotBlank() }
    if (cleanSegments.isEmpty() || playbackSegments.isEmpty()) return false
    if (cleanSegments.any { it.length > TextToSpeech.getMaxSpeechInputLength() }) return false

    playbackSegments = playbackSegments + cleanSegments
    segmentDurationsSeconds.addAll(List(cleanSegments.size) { 0.0 })
    if (audioMode && !playbackStopped && !playbackPaused) {
      prepareNextAudioFile(currentIndex + 1)
    } else if (!playbackStopped && !playbackPaused) {
      enqueueThrough(minOf(playbackSegments.lastIndex, currentIndex + 2))
    }
    return true
  }

  private fun queueUtterancesFrom(startIndex: Int) {
    val engine = tts ?: return
    if (playbackStopped || startIndex !in playbackSegments.indices) return

    utteranceGeneration += 1
    utteranceIndexes.clear()
    currentIndex = startIndex
    val lookaheadEnd = minOf(
      playbackSegments.lastIndex,
      startIndex + 2,
    )
    for (index in startIndex..lookaheadEnd) {
      val utteranceId = "readany-playback-$playbackGeneration-$utteranceGeneration-$index"
      utteranceIndexes[utteranceId] = index
      val params = Bundle().apply {
        putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
      }
      val queueMode = if (index == startIndex) {
        TextToSpeech.QUEUE_FLUSH
      } else {
        TextToSpeech.QUEUE_ADD
      }
      val result = engine.speak(playbackSegments[index], queueMode, params, utteranceId)
      if (result != TextToSpeech.SUCCESS) {
        if (index == startIndex) {
          playbackStopped = true
          sendStateEvent("stopped")
        }
        return
      }
      lastQueuedIndex = index
    }
  }

  private fun enqueueThrough(index: Int) {
    val engine = tts ?: return
    if (playbackStopped || index !in playbackSegments.indices) return
    if (index <= lastQueuedIndex) return

    val firstNewIndex = maxOf(currentIndex, lastQueuedIndex + 1)
    for (candidate in firstNewIndex..index) {
      val utteranceId = "readany-playback-$playbackGeneration-$utteranceGeneration-$candidate"
      utteranceIndexes[utteranceId] = candidate
      val params = Bundle().apply {
        putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
      }
      val result = engine.speak(
        playbackSegments[candidate],
        TextToSpeech.QUEUE_ADD,
        params,
        utteranceId,
      )
      if (result != TextToSpeech.SUCCESS) return
      lastQueuedIndex = candidate
    }
  }

  private fun handlePlaybackDone(utteranceId: String): Boolean {
    val index = utteranceIndexes[utteranceId] ?: return false
    val elapsedSeconds = (SystemClock.elapsedRealtime() - segmentStartedAtMs) / 1000.0
    if (index in segmentDurationsSeconds.indices) {
      segmentDurationsSeconds[index] = elapsedSeconds.coerceAtLeast(0.05)
      measuredSegmentIndexes.add(index)
    }

    if (index == playbackSegments.lastIndex) {
      utteranceIndexes.remove(utteranceId)
      playbackStopped = true
      playbackPaused = false
      sendPlaybackEvent(
        mapOf(
          "type" to "progress",
          "index" to index,
          "total" to playbackSegments.size,
          "position" to segmentDurationsSeconds.sum(),
          "duration" to segmentDurationsSeconds.sum(),
        ),
      )
      sendStateEvent("stopped")
      sendPlaybackEvent(mapOf("type" to "end", "index" to index, "total" to playbackSegments.size))
      return true
    }

    currentIndex = index + 1
    enqueueThrough(minOf(playbackSegments.lastIndex, currentIndex + 2))
    sendPlaybackEvent(
      mapOf(
        "type" to "chunk",
        "index" to currentIndex,
        "total" to playbackSegments.size,
        "position" to segmentDurationsSeconds.take(currentIndex).sum(),
        "duration" to estimateChapterDuration(),
      ),
    )
    return true
  }

  private fun pausePlayback() {
    val engine = tts ?: return
    if (playbackStopped || playbackPaused) return
    if (audioMode) {
      audioPlayer?.pause()
      playbackPaused = true
      sendStateEvent("paused")
      return
    }
    utteranceGeneration += 1
    utteranceIndexes.clear()
    engine.stop()
    playbackPaused = true
    sendStateEvent("paused")
  }

  private fun resumePlayback() {
    if (playbackStopped || !playbackPaused) return
    val options = playbackOptions ?: return
    val engine = tts ?: return
    playbackPaused = false
    if (audioMode) {
      val player = audioPlayer
      if (player != null) {
        updateAudioPlaybackParams(player)
        player.start()
        sendStateEvent("playing")
      } else {
        prepareAudioFile(currentIndex, startWhenReady = true)
      }
      return
    }
    applyOptions(engine, options)
    queueUtterancesFrom(currentIndex)
    sendStateEvent("playing")
  }

  private fun stopPlaybackInternal(sendEvents: Boolean) {
    val engine = tts
    utteranceGeneration += 1
    utteranceIndexes.clear()
    if (audioMode) {
      resetAudioSession()
    } else {
      engine?.stop()
    }
    audioMode = false
    playbackStopped = true
    playbackPaused = false
    if (sendEvents) sendStateEvent("stopped")
    if (sendEvents) stopPlaybackService()
  }

  private fun seekToChunk(index: Int) {
    val engine = tts
    if (engine == null || playbackStopped || index !in playbackSegments.indices) return
    val options = playbackOptions ?: return
    if (audioMode) {
      resetAudioSession()
      currentIndex = index
      initializeEstimatedDurationsBefore(index)
      prepareAudioFile(index, startWhenReady = true)
      sendStateEvent("playing")
      return
    }
    utteranceGeneration += 1
    utteranceIndexes.clear()
    engine.stop()
    currentIndex = index
    playbackPaused = false
    applyOptions(engine, options)
    initializeEstimatedDurationsBefore(index)
    queueUtterancesFrom(index)
    sendStateEvent("playing")
    sendPlaybackEvent(
      mapOf(
        "type" to "chunk",
        "index" to index,
        "total" to playbackSegments.size,
        "position" to segmentDurationsSeconds.take(index).sum(),
        "duration" to estimateChapterDuration(),
      ),
    )
  }

  private fun seekToPositionSeconds(positionSeconds: Double): Boolean {
    if (playbackStopped || playbackSegments.isEmpty()) return false
    initializeEstimatedDurationsBefore(playbackSegments.size)
    val targetSeconds = positionSeconds.coerceIn(0.0, estimateChapterDuration())
    var accumulatedSeconds = 0.0
    for (index in playbackSegments.indices) {
      accumulatedSeconds += segmentDurationsSeconds[index]
      if (targetSeconds <= accumulatedSeconds) {
        seekToChunk(index)
        return true
      }
    }
    seekToChunk(playbackSegments.lastIndex)
    return true
  }

  private fun shouldUseAudioPlayback(options: SynthesisOptions): Boolean {
    val rate = options.rate ?: 1.0
    val pitch = options.pitch ?: 1.0
    return kotlin.math.abs(rate - 1.0) > 0.001 || kotlin.math.abs(pitch - 1.0) > 0.001
  }

  private fun startAudioPlayback(startIndex: Int) {
    val engine = tts ?: return
    if (startIndex !in playbackSegments.indices) return
    audioMode = true
    utteranceGeneration += 1
    utteranceIndexes.clear()
    resetAudioSession()
    playbackPaused = false
    playbackStopped = false
    currentIndex = startIndex
    audioCurrentIndex = startIndex
    Log.i(
      "SystemTtsSynthesis",
      "start audio playback: index=$startIndex rate=${playbackOptions?.rate} pitch=${playbackOptions?.pitch}",
    )
    sendStateEvent("playing")
    prepareAudioFile(startIndex, startWhenReady = true)
  }

  private fun synthesisOptionsForAudio(): SynthesisOptions {
    val options = playbackOptions
    return SynthesisOptions(
      rate = 1.0,
      pitch = 1.0,
      language = options?.language,
      voice = options?.voice,
    )
  }

  private fun prepareAudioFile(index: Int, startWhenReady: Boolean) {
    val engine = tts ?: return
    val context = appContext.reactContext ?: return
    if (index !in playbackSegments.indices) return
    if (audioSynthesisRequests.values.any { it.index == index }) return

    if (nextAudioFile != null && nextAudioIndex == index) {
      val file = nextAudioFile
      nextAudioFile = null
      nextAudioIndex = -1
      if (file != null) {
        playAudioFile(file, index)
        return
      }
    }

    val file = File(context.cacheDir, "readany-system-tts-playback-${UUID.randomUUID()}.wav")
    val utteranceId = file.toURI().toString()
    applyOptions(engine, synthesisOptionsForAudio())
    audioSynthesisRequests[utteranceId] = AudioSynthesisRequest(file, index, startWhenReady)
    val result = engine.synthesizeToFile(playbackSegments[index], Bundle(), file, utteranceId)
    if (result != TextToSpeech.SUCCESS) {
      audioSynthesisRequests.remove(utteranceId)
      file.delete()
      if (startWhenReady) {
        playbackStopped = true
        sendStateEvent("stopped")
      }
    }
  }

  private fun prepareNextAudioFile(index: Int) {
    val engine = tts ?: return
    val context = appContext.reactContext ?: return
    if (index !in playbackSegments.indices) return
    if (nextAudioIndex == index || audioSynthesisRequests.values.any { it.index == index }) return

    nextAudioFile?.delete()
    val file = File(context.cacheDir, "readany-system-tts-playback-${UUID.randomUUID()}.wav")
    val utteranceId = file.toURI().toString()
    nextAudioIndex = index
    applyOptions(engine, synthesisOptionsForAudio())
    audioSynthesisRequests[utteranceId] = AudioSynthesisRequest(file, index, startWhenReady = false)
    val result = engine.synthesizeToFile(playbackSegments[index], Bundle(), file, utteranceId)
    if (result != TextToSpeech.SUCCESS) {
      audioSynthesisRequests.remove(utteranceId)
      file.delete()
      if (nextAudioFile == file) {
        nextAudioFile = null
        nextAudioIndex = -1
      }
    }
  }

  private fun handleAudioSynthesisDone(request: AudioSynthesisRequest) {
    if (playbackStopped) {
      request.file.delete()
      return
    }
    val shouldStartNow =
      request.startWhenReady ||
        (
          request.index == currentIndex &&
            audioPlayer == null &&
            !playbackStopped &&
            !playbackPaused
        )
    if (shouldStartNow) {
      Log.i("SystemTtsSynthesis", "audio synthesis ready: index=${request.index}")
      playAudioFile(request.file, request.index)
      return
    }
    if (request.index == currentIndex + 1) {
      nextAudioFile = request.file
      nextAudioIndex = request.index
    } else {
      request.file.delete()
    }
  }

  private fun playAudioFile(file: File, index: Int) {
    stopAudioPlayer()
    audioCurrentFile = file
    audioCurrentIndex = index
    currentIndex = index
    val player = MediaPlayer()
    audioPlayer = player
    player.setDataSource(file.absolutePath)
    player.setOnPreparedListener { prepared ->
      if (playbackStopped || playbackPaused) return@setOnPreparedListener
      updateAudioPlaybackParams(prepared)
      prepared.start()
      segmentStartedAtMs = SystemClock.elapsedRealtime()
      sendPlaybackEvent(
        mapOf(
          "type" to "chunk",
          "index" to index,
          "total" to playbackSegments.size,
          "position" to segmentDurationsSeconds.take(index).sum(),
          "duration" to estimateChapterDuration(),
        ),
      )
      prepareNextAudioFile(index + 1)
    }
    player.setOnCompletionListener {
      if (it !== audioPlayer) return@setOnCompletionListener
      handleAudioPlaybackCompleted()
    }
    player.setOnErrorListener { _, what, extra ->
      Log.e("SystemTtsSynthesis", "Audio playback failed: what=$what extra=$extra")
      playbackStopped = true
      sendStateEvent("stopped")
      true
    }
    player.prepareAsync()
  }

  private fun handleAudioPlaybackCompleted() {
    val completedIndex = audioCurrentIndex
    val player = audioPlayer
    if (completedIndex in segmentDurationsSeconds.indices && player != null) {
      val rate = (playbackOptions?.rate ?: 1.0).coerceAtLeast(0.1)
      segmentDurationsSeconds[completedIndex] = player.duration / 1000.0 / rate
      measuredSegmentIndexes.add(completedIndex)
    }
    stopAudioPlayer()
    audioCurrentFile?.delete()
    audioCurrentFile = null

    val nextIndex = completedIndex + 1
    if (nextIndex !in playbackSegments.indices) {
      playbackStopped = true
      sendStateEvent("stopped")
      sendPlaybackEvent(
        mapOf(
          "type" to "end",
          "index" to completedIndex,
          "total" to playbackSegments.size,
        ),
      )
      return
    }

    currentIndex = nextIndex
    val cachedFile = nextAudioFile
    if (cachedFile != null && nextAudioIndex == nextIndex) {
      nextAudioFile = null
      nextAudioIndex = -1
      playAudioFile(cachedFile, nextIndex)
    } else {
      prepareAudioFile(nextIndex, startWhenReady = true)
    }
  }

  private fun updateAudioPlaybackParams(player: MediaPlayer? = audioPlayer) {
    val target = player ?: return
    val rate = (playbackOptions?.rate ?: 1.0).toFloat().coerceAtLeast(0.1f)
    val pitch = (playbackOptions?.pitch ?: 1.0).toFloat().coerceAtLeast(0.1f)
    target.playbackParams = PlaybackParams().setSpeed(rate).setPitch(pitch)
  }

  private fun stopAudioPlayer() {
    val player = audioPlayer ?: return
    audioPlayer = null
    try {
      player.stop()
    } catch (_: IllegalStateException) {
    }
    player.release()
  }

  private fun resetAudioSession() {
    audioSynthesisRequests.values.forEach { it.file.delete() }
    audioSynthesisRequests.clear()
    tts?.stop()
    stopAudioPlayer()
    audioCurrentFile?.delete()
    audioCurrentFile = null
    nextAudioFile?.delete()
    nextAudioFile = null
    nextAudioIndex = -1
    audioCurrentIndex = -1
  }

  private fun estimateChapterDuration(): Double {
    val measured = segmentDurationsSeconds.mapIndexed { index, duration -> index to duration }
      .filter { it.second > 0 }
    if (measured.isNotEmpty()) {
      val measuredCharacters = measured.sumOf { playbackSegments[it.first].length }
      if (measuredCharacters > 0) {
        val secondsPerCharacter = measured.sumOf { it.second } / measuredCharacters
        return playbackSegments.sumOf { maxOf(1, it.length) } * secondsPerCharacter
      }
    }
    return playbackSegments.sumOf { maxOf(1, it.length) } / 6.0
  }

  private fun initializeEstimatedDurationsBefore(endIndex: Int) {
    val rate = (playbackOptions?.rate ?: 1.0).coerceAtLeast(0.1)
    val secondsPerCharacter = 1.0 / (6.0 * rate)
    for (index in 0 until endIndex.coerceAtMost(segmentDurationsSeconds.size)) {
      if (index in measuredSegmentIndexes || segmentDurationsSeconds[index] > 0) continue
      val characters = maxOf(1, playbackSegments.getOrNull(index)?.length ?: 1)
      segmentDurationsSeconds[index] = characters * secondsPerCharacter
    }
  }

  private fun sendStateEvent(state: String) {
    notifyPlaybackService(state)
    sendPlaybackEvent(
      mapOf(
        "type" to "state",
        "state" to state,
        "index" to currentIndex,
        "total" to playbackSegments.size,
      ),
    )
  }

  private fun sendPlaybackEvent(payload: Map<String, Any?>) {
    val now = SystemClock.elapsedRealtime()
    if (payload["type"] == "progress" && now - progressUpdateAtMs < 250) return
    progressUpdateAtMs = now
    if (payload["type"] == "chunk" || payload["type"] == "progress") {
      notifyPlaybackService(
        when {
          playbackStopped -> "stopped"
          playbackPaused -> "paused"
          else -> "playing"
        },
      )
    }
    sendEvent("SystemTtsPlayback", bundleOf(*payload.map { it.key to it.value }.toTypedArray()))
  }

  private fun notifyPlaybackService(state: String) {
    val position = if (playbackStopped) {
      segmentDurationsSeconds.sum()
    } else {
      segmentDurationsSeconds.take(currentIndex).sum()
    }
    val snapshot = SystemTtsPlaybackState.Snapshot(
      state,
      currentIndex,
      playbackSegments.size,
      position,
      estimateChapterDuration(),
      state == "playing",
      playbackOptions?.rate?.toFloat() ?: 1.0f,
    )
    SystemTtsPlaybackState.lastSnapshot = snapshot
    SystemTtsPlaybackState.notifier?.invoke(snapshot)
  }

  private fun startPlaybackService() {
    val context = appContext.reactContext ?: return
    val intent = Intent(context, SystemTtsPlaybackService::class.java)
    context.startForegroundService(intent)
  }

  private fun stopPlaybackService() {
    val context = appContext.reactContext ?: return
    context.stopService(Intent(context, SystemTtsPlaybackService::class.java))
  }

  private fun applyOptions(engine: TextToSpeech, options: SynthesisOptions) {
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

    options.rate?.let {
      val result = engine.setSpeechRate(it.toFloat())
      Log.i("SystemTtsSynthesis", "setSpeechRate(${it}): $result")
    }
    options.pitch?.let {
      val result = engine.setPitch(it.toFloat())
      Log.i("SystemTtsSynthesis", "setPitch(${it}): $result")
    }
  }
}
