package com.pacbas.attendance.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import com.pacbas.attendance.model.Beacon

/**
 * Thin wrapper around Android's BluetoothLeScanner.
 *
 * Deliberately does NOT filter by service UUID at the OS scan-filter level,
 * because iBeacon data lives in manufacturer-specific data, not the
 * advertised service UUID list -- filtering happens after parsing instead,
 * in the callback below.
 */
class BleScanner(
    context: Context,
    private val onBeaconUpdated: (Beacon) -> Unit,
    private val onScanFailed: ((Int) -> Unit)? = null
) {

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? = bluetoothManager.adapter
    private var scanning = false

    // uuid -> Beacon, so repeated advertisements from the same beacon update
    // the same rolling RSSI window instead of creating duplicate entries.
    private val seenBeacons = mutableMapOf<String, Beacon>()

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val parsed = BeaconParser.parse(result.scanRecord) ?: return
            val existing = seenBeacons[parsed.uuid]
            val beacon = existing ?: parsed
            beacon.addSample(result.rssi)
            seenBeacons[parsed.uuid] = beacon
            onBeaconUpdated(beacon)
        }

        override fun onScanFailed(errorCode: Int) {
            scanning = false
            onScanFailed?.invoke(errorCode)
        }
    }

    fun isBluetoothEnabled(): Boolean = adapter?.isEnabled == true

    @Suppress("MissingPermission") // caller is responsible for the runtime permission check
    fun startScan() {
        if (scanning) return
        val scanner = adapter?.bluetoothLeScanner ?: return
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        scanner.startScan(null, settings, scanCallback)
        scanning = true
    }

    @Suppress("MissingPermission")
    fun stopScan() {
        if (!scanning) return
        adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        scanning = false
    }

    fun clearSeenBeacons() {
        seenBeacons.clear()
    }
}
