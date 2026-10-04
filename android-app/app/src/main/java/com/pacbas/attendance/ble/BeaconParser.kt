package com.pacbas.attendance.ble

import android.bluetooth.le.ScanRecord
import com.pacbas.attendance.model.Beacon
import java.nio.ByteBuffer
import java.util.UUID

/**
 * Parses standard iBeacon-formatted manufacturer-specific advertising data
 * out of a raw Android ScanRecord. Matches the packet layout the ESP32
 * firmware (PACBAS_Beacon.ino) broadcasts via the BLEBeacon Arduino class.
 *
 * iBeacon manufacturer data layout (25 bytes total after the 0x4C company ID):
 *   byte 0-1   : Beacon type/length header (0x02, 0x15)
 *   byte 2-17  : Proximity UUID (16 bytes)
 *   byte 18-19 : Major (big-endian uint16)
 *   byte 20-21 : Minor (big-endian uint16)
 *   byte 22    : Measured Power / Tx Power at 1m (signed byte)
 */
object BeaconParser {
    private const val APPLE_COMPANY_ID = 0x004C

    fun parse(scanRecord: ScanRecord?): Beacon? {
        val record = scanRecord ?: return null

        // 1. Try standard parsed manufacturer data first
        val data = record.getManufacturerSpecificData(APPLE_COMPANY_ID)
        if (data != null && data.size >= 23 && data[0] == 0x02.toByte() && data[1] == 0x15.toByte()) {
            return parseFromPayload(data, 2)
        }

        // 2. Fallback: scan raw advertising packet directly (handles OEM ROM quirks)
        val bytes = record.bytes ?: return null
        var i = 0
        while (i < bytes.size - 2) {
            val length = bytes[i].toInt() and 0xFF
            if (length == 0) break
            if (i + 1 + length > bytes.size) break

            val type = bytes[i + 1].toInt() and 0xFF
            // 0xFF = Manufacturer Specific Data
            if (type == 0xFF && length >= 25 && i + 5 < bytes.size) {
                val companyLow = bytes[i + 2].toInt() and 0xFF
                val companyHigh = bytes[i + 3].toInt() and 0xFF
                if (companyLow == 0x4C && companyHigh == 0x00) {
                    val subType = bytes[i + 4].toInt() and 0xFF
                    val subLength = bytes[i + 5].toInt() and 0xFF
                    if (subType == 0x02 && subLength == 0x15 && length >= 26) {
                        return parseFromRawBytes(bytes, i + 6)
                    }
                }
            }
            i += length + 1
        }

        return null
    }

    private fun parseFromPayload(data: ByteArray, offset: Int): Beacon {
        val uuidBytes = data.copyOfRange(offset, offset + 16)
        val bb = ByteBuffer.wrap(uuidBytes)
        val high = bb.long
        val low = bb.long
        val uuid = UUID(high, low).toString()

        val major = ((data[offset + 16].toInt() and 0xFF) shl 8) or (data[offset + 17].toInt() and 0xFF)
        val minor = ((data[offset + 18].toInt() and 0xFF) shl 8) or (data[offset + 19].toInt() and 0xFF)
        val measuredPower = data[offset + 20].toInt()

        return Beacon(uuid = uuid, major = major, minor = minor, measuredPower = measuredPower)
    }

    private fun parseFromRawBytes(bytes: ByteArray, uuidStart: Int): Beacon {
        val uuidBytes = bytes.copyOfRange(uuidStart, uuidStart + 16)
        val bb = ByteBuffer.wrap(uuidBytes)
        val high = bb.long
        val low = bb.long
        val uuid = UUID(high, low).toString()

        val major = ((bytes[uuidStart + 16].toInt() and 0xFF) shl 8) or (bytes[uuidStart + 17].toInt() and 0xFF)
        val minor = ((bytes[uuidStart + 18].toInt() and 0xFF) shl 8) or (bytes[uuidStart + 19].toInt() and 0xFF)
        val measuredPower = bytes[uuidStart + 20].toInt()

        return Beacon(uuid = uuid, major = major, minor = minor, measuredPower = measuredPower)
    }
}
