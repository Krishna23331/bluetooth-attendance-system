package com.pacbas.attendance.model

/**
 * A single scanned beacon observation, refreshed every time we hear a new
 * advertisement from this UUID. RSSI is kept as a rolling window (SRS 5.2.2)
 * rather than a single instantaneous sample, so the in-range judgement is
 * based on a trimmed mean instead of one noisy reading.
 */
data class Beacon(
    val uuid: String,
    val major: Int,
    val minor: Int,
    val measuredPower: Int,     // "A" - calibrated RSSI at 1 meter, broadcast by the beacon itself
    val rssiWindow: MutableList<Int> = mutableListOf(),
    var lastSeenMs: Long = System.currentTimeMillis()
) {
    companion object {
        const val WINDOW_SIZE = 10
        const val PATH_LOSS_EXPONENT_N = 2.7   // default; should match backend's per-room value
        const val RSSI_CUTOFF_DBM = -75        // SRS 5.2.1 hard floor
    }

    fun addSample(rssi: Int) {
        rssiWindow.add(rssi)
        if (rssiWindow.size > WINDOW_SIZE) rssiWindow.removeAt(0)
        lastSeenMs = System.currentTimeMillis()
    }

    /** Trimmed mean: drop the single highest and lowest sample if we have enough data. */
    fun trimmedMeanRssi(): Double {
        if (rssiWindow.isEmpty()) return -999.0
        if (rssiWindow.size < 3) return rssiWindow.average()
        val sorted = rssiWindow.sorted()
        val trimmed = sorted.subList(1, sorted.size - 1)
        return trimmed.average()
    }

    /** Log-Distance Path Loss Model, SRS Section 5.2.1: d = 10 ^ ((A - RSSI) / (10 * n)) */
    fun estimatedDistanceMeters(): Double {
        val rssi = trimmedMeanRssi()
        if (rssi <= -200.0) return 99.9
        val d = Math.pow(10.0, (measuredPower - rssi) / (10.0 * PATH_LOSS_EXPONENT_N))
        return if (d.isNaN() || d.isInfinite()) 99.9 else d
    }

    fun isInRange(): Boolean = trimmedMeanRssi() >= RSSI_CUTOFF_DBM
}
