package com.pacbas.attendance.network

import android.content.Context
import android.content.SharedPreferences
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Talks to the PACBAS MVP backend's /checkin endpoints.
 * Supports dynamic configuration of the server IP/URL so users
 * do not need to recompile the app when their network address changes.
 */
object ApiClient {

    private const val PREF_NAME = "pacbas_config"
    private const val KEY_BASE_URL = "base_url"
    private const val DEFAULT_BASE_URL = "http://192.168.1.42:3000"
    var BASE_URL: String = DEFAULT_BASE_URL

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    private val JSON = "application/json; charset=utf-8".toMediaType()

    fun init(context: Context) {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        BASE_URL = prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
    }

    fun setBaseUrl(context: Context, newUrl: String) {
        var sanitized = newUrl.trim()
        if (!sanitized.startsWith("http://") && !sanitized.startsWith("https://")) {
            sanitized = "http://$sanitized"
        }
        if (sanitized.endsWith("/")) {
            sanitized = sanitized.substring(0, sanitized.length - 1)
        }
        BASE_URL = sanitized
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_BASE_URL, sanitized)
            .apply()
    }

    /** Stable per-device identifier (survives app reinstall; changes only on factory reset). */
    @android.annotation.SuppressLint("HardwareIds")
    fun getDeviceId(context: Context): String =
        android.provider.Settings.Secure.getString(
            context.applicationContext.contentResolver,
            android.provider.Settings.Secure.ANDROID_ID
        ) ?: "unknown-device"

    sealed class CheckInResult {
        data class Success(
            val roomName: String,
            val distanceMeters: Double,
            val rssi: Int,
            val sessionStartedAt: String = ""
        ) : CheckInResult()
        data class SessionError(val reason: String, val isDuplicate: Boolean = false) : CheckInResult()
        data class Rejected(val reason: String, val distanceMeters: Double, val rssi: Int) : CheckInResult()
        data class Error(val message: String) : CheckInResult()
    }

    fun checkIn(
        context: Context,
        studentId: String,
        beaconUuid: String,
        rssi: Int,
        callback: (CheckInResult) -> Unit
    ) {
        val isoTimestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        val body = JSONObject().apply {
            put("studentId", studentId)
            put("enrollmentNumber", studentId)
            put("deviceId", getDeviceId(context))
            put("beaconUuid", beaconUuid)
            put("rssi", rssi)
            put("clientTimestamp", isoTimestamp)
        }.toString().toRequestBody(JSON)

        val request = Request.Builder()
            .url("$BASE_URL/checkin")
            .post(body)
            .build()

        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: IOException) {
                callback(CheckInResult.Error(e.message ?: "Network error -- check server IP and Wi-Fi connection."))
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                response.use {
                    val text = it.body?.string() ?: "{}"
                    val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
                    when (it.code) {
                        201 -> callback(
                            CheckInResult.Success(
                                roomName = json.optString("roomName", "Unknown room"),
                                distanceMeters = json.optDouble("estimatedDistanceMeters", -1.0),
                                rssi = json.optInt("rssi"),
                                sessionStartedAt = json.optString("sessionStartedAt", "")
                            )
                        )
                        409 -> callback(
                            CheckInResult.SessionError(
                                reason = json.optString("error", "No active class session or already checked in."),
                                isDuplicate = json.optString("code") in listOf("ALREADY_CHECKED_IN", "DEVICE_ALREADY_USED")
                            )
                        )
                        403 -> callback(
                            CheckInResult.Rejected(
                                reason = json.optString("error", "Outside RSSI boundary (cutoff ${json.optInt("cutoffDbm")} dBm)"),
                                distanceMeters = json.optDouble("estimatedDistanceMeters", -1.0),
                                rssi = json.optInt("rssi")
                            )
                        )
                        else -> callback(CheckInResult.Error(json.optString("error", "HTTP ${it.code}")))
                    }
                }
            }
        })
    }
}