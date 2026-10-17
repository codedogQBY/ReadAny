package expo.modules.systemttssynthesis

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.URL

class SystemTtsPlaybackService : Service() {
  private lateinit var mediaSession: MediaSessionCompat
  private lateinit var audioManager: AudioManager
  private val mainHandler = Handler(Looper.getMainLooper())
  private var snapshot = SystemTtsPlaybackState.Snapshot(
    "stopped",
    0,
    0,
    0.0,
    0.0,
    false,
    1.0f,
  )
  private var snapshotUpdatedAtMs = 0L
  private var focusRequest: AudioFocusRequest? = null
  private var artworkCacheKey: String? = null
  private var artworkCache: Bitmap? = null

  private val progressRunnable = object : Runnable {
    override fun run() {
      if (snapshot.playing) updatePlaybackState()
      mainHandler.postDelayed(this, 500)
    }
  }

  override fun onCreate() {
    super.onCreate()
    audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    mediaSession = MediaSessionCompat(this, "ReadAnySystemTts").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = SystemTtsPlaybackState.resumeCommand?.invoke() ?: Unit
        override fun onPause() = SystemTtsPlaybackState.pauseCommand?.invoke() ?: Unit
        override fun onStop() = SystemTtsPlaybackState.stopCommand?.invoke() ?: Unit
        override fun onSkipToNext() = SystemTtsPlaybackState.nextCommand?.invoke() ?: Unit
        override fun onSkipToPrevious() = SystemTtsPlaybackState.previousCommand?.invoke() ?: Unit
        override fun onSeekTo(pos: Long) {
          Log.i("SystemTtsPlaybackService", "MediaSession seekTo: $pos")
          applyOptimisticSeek(pos)
          val handled = SystemTtsPlaybackState.nativeSeekCommand?.invoke(pos / 1000.0) ?: false
          if (!handled) SystemTtsPlaybackState.seekCommand?.invoke(pos / 1000.0)
        }

        override fun onCustomAction(action: String?, extras: Bundle?) {
          if (action == STOP_ACTION) SystemTtsPlaybackState.stopCommand?.invoke()
        }
      })
      setSessionActivity(contentIntent())
      isActive = true
    }

    SystemTtsPlaybackState.notifier = ::handleSnapshot
    SystemTtsPlaybackState.metadataListener = ::handleMetadata
    SystemTtsPlaybackState.lastSnapshot?.let(::handleSnapshot)
  }

  override fun onStartCommand(
    intent: Intent?,
    flags: Int,
    startId: Int,
  ): Int {
    if (intent?.action == "stop") {
      SystemTtsPlaybackState.stopCommand?.invoke()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    handleIntentAction(intent?.action)
    createNotificationChannel()
    requestAudioFocus()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    updateMetadata()
    updatePlaybackState()
    mainHandler.removeCallbacks(progressRunnable)
    mainHandler.postDelayed(progressRunnable, 500)
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    mainHandler.removeCallbacksAndMessages(null)
    SystemTtsPlaybackState.notifier = null
    SystemTtsPlaybackState.metadataListener = null
    mediaSession.isActive = false
    mediaSession.release()
    abandonAudioFocus()
    super.onDestroy()
  }

  private fun handleIntentAction(action: String?) {
    when (action) {
      "play" -> SystemTtsPlaybackState.resumeCommand?.invoke()
      "pause" -> SystemTtsPlaybackState.pauseCommand?.invoke()
      "stop" -> SystemTtsPlaybackState.stopCommand?.invoke()
      "next" -> {
        Log.i("SystemTtsPlaybackService", "Notification action next")
        SystemTtsPlaybackState.nextCommand?.invoke()
      }
      "previous" -> {
        Log.i("SystemTtsPlaybackService", "Notification action previous")
        SystemTtsPlaybackState.previousCommand?.invoke()
      }
    }
  }

  private fun handleSnapshot(next: SystemTtsPlaybackState.Snapshot) {
    snapshot = next
    snapshotUpdatedAtMs = SystemClock.elapsedRealtime()
    updateMetadata()
    updatePlaybackState()
    if (next.state == "stopped" && next.total > 0 && next.index >= next.total - 1) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    } else {
      notifyNotification()
    }
  }

  private fun handleMetadata(metadata: SystemTtsPlaybackState.Metadata) {
    updateMetadata()
    notifyNotification()
  }

  private fun createNotificationChannel() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "ReadAny system reading",
      NotificationManager.IMPORTANCE_LOW,
    )
    manager.createNotificationChannel(channel)
  }

  private fun updateMetadata() {
    val metadata = SystemTtsPlaybackState.metadata
    val builder = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, metadata.title)
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, metadata.artist)
      .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, metadata.album)
      .putLong(
        MediaMetadataCompat.METADATA_KEY_DURATION,
        (snapshot.durationSeconds * 1000).toLong(),
      )
    val artwork = decodeArtwork(metadata.artworkUri)
    if (artwork != null) {
      builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork)
      builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork)
    }
    mediaSession.setMetadata(builder.build())
  }

  private fun decodeArtwork(uriText: String?): Bitmap? {
    if (uriText.isNullOrBlank()) return null
    if (artworkCacheKey == uriText) return artworkCache
    artworkCacheKey = uriText
    artworkCache = null
    return try {
      val uri = android.net.Uri.parse(uriText)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }

      fun openStream() = when (uri.scheme) {
        "content" -> contentResolver.openInputStream(uri)
        "http", "https" -> URL(uri.toString()).openStream()
        "file" -> contentResolver.openInputStream(uri)
        else -> java.io.File(uriText).inputStream()
      }

      openStream()?.use { BitmapFactory.decodeStream(it, null, bounds) }
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

      var sampleSize = 1
      while (bounds.outWidth / sampleSize > 512 || bounds.outHeight / sampleSize > 512) {
        sampleSize *= 2
      }
      val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
      val bitmap = openStream()?.use { BitmapFactory.decodeStream(it, null, options) }
      artworkCache = bitmap
      bitmap
    } catch (error: Exception) {
      Log.w("SystemTtsPlaybackService", "Failed to decode artwork", error)
      null
    }
  }

  private fun applyOptimisticSeek(positionMs: Long) {
    val durationMs = (snapshot.durationSeconds * 1000).toLong().coerceAtLeast(1)
    val targetMs = positionMs.coerceIn(0L, durationMs)
    snapshot = snapshot.copy(
      positionSeconds = targetMs / 1000.0,
      durationSeconds = durationMs / 1000.0,
      playing = true,
      state = "playing",
    )
    snapshotUpdatedAtMs = SystemClock.elapsedRealtime()
    updatePlaybackState()
    notifyNotification()
  }

  private fun currentPositionMs(): Long {
    val elapsedMs = SystemClock.elapsedRealtime() - snapshotUpdatedAtMs
    val elapsed = if (snapshot.playing) {
      elapsedMs * snapshot.speed
    } else {
      0.0f
    }
    return ((snapshot.positionSeconds * 1000) + elapsed).toLong()
  }

  private fun updatePlaybackState() {
    val state = when (snapshot.state) {
      "playing" -> PlaybackStateCompat.STATE_PLAYING
      "paused" -> PlaybackStateCompat.STATE_PAUSED
      else -> PlaybackStateCompat.STATE_STOPPED
    }
    mediaSession.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(
          PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SEEK_TO,
        )
        .addCustomAction(
          PlaybackStateCompat.CustomAction.Builder(
            STOP_ACTION,
            "停止",
            R.drawable.ic_system_tts_stop,
          ).build(),
        )
        .setState(state, currentPositionMs(), if (snapshot.playing) snapshot.speed else 0f)
        .build(),
    )
  }

  private fun buildNotification(): Notification {
    val previousIntent = actionIntent("previous")
    val playPauseIntent = actionIntent(if (snapshot.playing) "pause" else "play")
    val nextIntent = actionIntent("next")
    val stopIntent = actionIntent("stop")
    val metadata = SystemTtsPlaybackState.metadata

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle(metadata.title)
      .setContentText(metadata.artist)
      .setContentIntent(contentIntent())
      .setLargeIcon(decodeArtwork(metadata.artworkUri))
      .setOngoing(snapshot.playing)
      .setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .addAction(android.R.drawable.ic_media_previous, "上一章", previousIntent)
      .addAction(
        if (snapshot.playing) {
          android.R.drawable.ic_media_pause
        } else {
          android.R.drawable.ic_media_play
        },
        if (snapshot.playing) "暂停" else "播放",
        playPauseIntent,
      )
      .addAction(android.R.drawable.ic_media_next, "下一章", nextIntent)
      .addAction(R.drawable.ic_system_tts_stop, "停止", stopIntent)
      .setStyle(
        MediaStyle()
          .setMediaSession(mediaSession.sessionToken)
          .setShowActionsInCompactView(0, 1, 2),
      )
      .build()
  }

  private fun notifyNotification() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, buildNotification())
  }

  private fun actionIntent(action: String): PendingIntent {
    val intent = Intent(this, SystemTtsPlaybackService::class.java).setAction(action)
    return PendingIntent.getService(
      this,
      action.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun contentIntent(): PendingIntent {
    val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    } ?: Intent()
    return PendingIntent.getActivity(
      this,
      NOTIFICATION_ID,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun requestAudioFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        .build()
      focusRequest = request
      audioManager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        null,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN,
      )
    }
  }

  private fun abandonAudioFocus() {
    val request = focusRequest
    if (request != null) {
      audioManager.abandonAudioFocusRequest(request)
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(null)
    }
  }

  companion object {
    private const val CHANNEL_ID = "readany_system_tts"
    private const val NOTIFICATION_ID = 21
    private const val STOP_ACTION = "expo.modules.systemttssynthesis.STOP"
  }
}
