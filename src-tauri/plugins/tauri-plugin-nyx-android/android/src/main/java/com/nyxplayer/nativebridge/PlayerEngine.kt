package com.nyxplayer.nativebridge

import app.tauri.plugin.JSObject

/** Sends a plugin event to the frontend (`property`, `error`). Must be thread-safe. */
typealias EngineEmitter = (event: String, payload: JSObject) -> Unit

/**
 * Video engine rendered behind the transparent Tauri WebView.
 *
 * Every engine speaks mpv property names (`time-pos`, `paused-for-cache`, `track-list`…)
 * so the React player code stays identical on desktop (mpv.exe) and Android (libmpv).
 * All methods are called on the main thread.
 */
interface PlayerEngine {
    /** Engine name reported in errors and diagnostics (`libmpv`) */
    val id: String

    fun play(url: String, startSeconds: Double, userAgent: String?)
    fun stop()
    fun setPaused(paused: Boolean)
    fun seek(seconds: Double, relative: Boolean)
    fun setVolume(value: Double)
    fun setMuted(value: Boolean)
    fun setSpeed(speed: Double)
    fun selectTrack(type: String, id: Int)
    /** fit | fill | stretch */
    fun setResizeMode(mode: String)
    /** Ratios of the parent size, like mpv's video-margin-ratio-* options. */
    fun setVideoMargins(left: Double, right: Double, top: Double, bottom: Double)
    fun setSubtitleScale(scale: Double)
    fun getProperty(name: String): Any?

    /**
     * The app is no longer visible: close the stream instead of pausing it. A paused
     * HTTP stream keeps its connection open, i.e. the IPTV provider still counts a busy
     * slot and another device gets HTTP 458 (connection limit). Until [onForeground], a
     * [play] (automatic retry, zap) is only remembered: nothing plays without a picture.
     */
    fun onBackground()
    /** Reopens what [onBackground] closed (live: latest position, VOD: same position). */
    fun onForeground()
    fun release()
}

/** Error payload shared by the engines (classified in playbackErrors.ts). */
fun errorPayload(engine: String, code: String, httpStatus: Int? = null, detail: String? = null): JSObject =
    JSObject().apply {
        put("engine", engine)
        put("code", code)
        if (httpStatus != null) put("httpStatus", httpStatus)
        if (!detail.isNullOrBlank()) put("detail", detail)
    }
