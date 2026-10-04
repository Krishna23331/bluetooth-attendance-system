package com.pacbas.attendance.ui

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.EditText
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.snackbar.Snackbar
import com.pacbas.attendance.R
import com.pacbas.attendance.ble.BleScanner
import com.pacbas.attendance.databinding.ActivityMainBinding
import com.pacbas.attendance.model.Beacon
import com.pacbas.attendance.network.ApiClient

import android.content.Context
import android.location.LocationManager
import android.provider.Settings

/**
 * PACBAS Attendance System — Modernized Android Client.
 * Features:
 *  - Real-time BLE beacon radar discovery with visual signal meters
 *  - Dynamic server IP/host configuration without recompiling
 *  - In-range proximity verification and check-in dispatching
 *  - Material 3 cards, empty states, and feedback snackbars
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var bleScanner: BleScanner
    private lateinit var adapter: BeaconAdapter

    private val requiredPermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        } else {
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results.values.all { it }) {
            startScanning()
        } else {
            Snackbar.make(binding.root, "Bluetooth and Location permissions are required to scan for beacons.", Snackbar.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Initialize API client with persisted URL if available
        ApiClient.init(this)
        updateServerHostDisplay()

        adapter = BeaconAdapter(onCheckInClicked = ::handleCheckIn)
        binding.recyclerBeacons.layoutManager = LinearLayoutManager(this)
        binding.recyclerBeacons.adapter = adapter

        bleScanner = BleScanner(
            context = this,
            onBeaconUpdated = { beacon ->
                runOnUiThread {
                    adapter.submitList(beacon)
                    updateListVisibility()
                }
            },
            onScanFailed = { errorCode ->
                runOnUiThread {
                    setScanningUiState(false)
                    Snackbar.make(binding.root, "BLE scan failed (Error code $errorCode). Try toggling Bluetooth.", Snackbar.LENGTH_LONG).show()
                }
            }
        )

        binding.buttonScan.setOnClickListener {
            if (hasAllPermissions()) startScanning() else permissionLauncher.launch(requiredPermissions)
        }

        binding.buttonStopScan.setOnClickListener {
            bleScanner.stopScan()
            setScanningUiState(false)
        }

        binding.buttonServerConfig.setOnClickListener {
            showServerConfigDialog()
        }

        updateListVisibility()
    }

    private fun updateServerHostDisplay() {
        val cleanHost = ApiClient.BASE_URL
            .removePrefix("http://")
            .removePrefix("https://")
        binding.textServerHost.text = cleanHost
    }

    private fun showServerConfigDialog() {
        val input = EditText(this).apply {
            setText(ApiClient.BASE_URL)
            setSelection(text.length)
            setPadding(48, 32, 48, 32)
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.server_config_title)
            .setMessage("Set your laptop or backend IP address (e.g. http://192.168.1.42:3000):")
            .setView(input)
            .setPositiveButton(R.string.save) { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.isNotEmpty()) {
                    ApiClient.setBaseUrl(this, newUrl)
                    updateServerHostDisplay()
                    Snackbar.make(binding.root, "Server URL updated to ${ApiClient.BASE_URL}", Snackbar.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun updateListVisibility() {
        if (adapter.isEmpty()) {
            binding.layoutEmptyState.visibility = View.VISIBLE
            binding.recyclerBeacons.visibility = View.GONE
        } else {
            binding.layoutEmptyState.visibility = View.GONE
            binding.recyclerBeacons.visibility = View.VISIBLE
        }
    }

    private fun hasAllPermissions(): Boolean =
        requiredPermissions.all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }

    private fun isLocationServiceEnabled(): Boolean {
        val locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    private fun startScanning() {
        if (!bleScanner.isBluetoothEnabled()) {
            startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            return
        }
        if (!isLocationServiceEnabled()) {
            Snackbar.make(
                binding.root,
                "⚠️ Location (GPS) must be turned on to scan for BLE beacons.",
                Snackbar.LENGTH_LONG
            ).setAction("Settings") {
                startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            }.show()
            return
        }
        adapter.clear()
        updateListVisibility()
        bleScanner.clearSeenBeacons()
        bleScanner.startScan()
        setScanningUiState(true)
    }

    private fun setScanningUiState(scanning: Boolean) {
        binding.buttonScan.isEnabled = !scanning
        binding.buttonStopScan.isEnabled = scanning
        binding.buttonScan.alpha = if (scanning) 0.6f else 1.0f
        binding.textScanStatus.text = if (scanning) getString(R.string.scanning_status_active) else getString(R.string.scanning_status_idle)

        val tintColor = ContextCompat.getColor(
            this,
            if (scanning) R.color.pacbas_primary else R.color.pacbas_text_muted
        )
        binding.imageRadarStatus.setColorFilter(tintColor)
    }

    private fun handleCheckIn(beacon: Beacon) {
        val studentId = binding.editStudentId.text?.toString()?.trim()
        if (studentId.isNullOrEmpty()) {
            Snackbar.make(binding.root, "⚠️ Enter your Student ID above before checking in.", Snackbar.LENGTH_SHORT).show()
            binding.editStudentId.requestFocus()
            return
        }
        val rssiSnapshot = beacon.trimmedMeanRssi().toInt()

        Snackbar.make(binding.root, "Verifying proximity with backend...", Snackbar.LENGTH_SHORT).show()

        ApiClient.checkIn(this, studentId, beacon.uuid, rssiSnapshot) { result ->
            runOnUiThread {
                val message = when (result) {
                    is ApiClient.CheckInResult.Success -> {
                        val sessionInfo = if (result.sessionStartedAt.isNotBlank()) {
                            val time = result.sessionStartedAt.substringAfter("T").substringBefore("Z").take(8)
                                .ifEmpty { result.sessionStartedAt.takeLast(8) }
                            " [Class: $time]"
                        } else ""
                        "✅ Present in ${result.roomName}$sessionInfo (~${"%.1f".format(result.distanceMeters)} m, ${result.rssi} dBm)"
                    }
                    is ApiClient.CheckInResult.SessionError -> {
                        if (result.isDuplicate) {
                            "ℹ️ ${result.reason}"
                        } else {
                            "⛔ ${result.reason}"
                        }
                    }
                    is ApiClient.CheckInResult.Rejected ->
                        "❌ Rejected (Out of Range): ${result.reason} (~${"%.1f".format(result.distanceMeters)} m)"
                    is ApiClient.CheckInResult.Error ->
                        "⚠️ ${result.message}"
                }
                Snackbar.make(binding.root, message, Snackbar.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        bleScanner.stopScan()
    }
}