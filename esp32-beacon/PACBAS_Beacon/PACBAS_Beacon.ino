/*
 * PACBAS - Proximity-Based Anti-Cheat Bluetooth Attendance System
 * ESP32 Beacon Firmware — Stable minimal version
 *
 * Board:  ESP32 DevKit (WROOM-32)
 * Mode:   Continuous iBeacon BLE advertiser
 *
 * Changes from original:
 *  - Removed dynamic interval switching (was causing crashes on some lib versions)
 *  - Single fixed 100ms advertising interval for maximum discoverability
 *  - No stop/start cycling in loop() — once started, never touched again
 *  - Watchdog-safe: loop() only does Serial prints, nothing BLE
 */

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEBeacon.h>
#include <BLEAdvertising.h>

// ---------- PER-ROOM CONFIGURATION (edit before flashing each unit) ----------
#define ROOM_UUID      "8ec76ea3-6668-48da-9866-75be8bc86f4d"
#define ROOM_MAJOR     101
#define ROOM_MINOR     1
#define MEASURED_POWER -68.5      // RSSI at 1 meter — calibrate later
#define DEVICE_NAME    "PACBAS-Beacon-101-1"

void setup() {
  Serial.begin(115200);
  delay(1000);  // Give serial monitor time to connect
  Serial.println();
  Serial.println("=== PACBAS Beacon starting ===");
  Serial.printf("UUID:  %s\n", ROOM_UUID);
  Serial.printf("Major: %d  Minor: %d\n", ROOM_MAJOR, ROOM_MINOR);

  // Init BLE stack
  BLEDevice::init(DEVICE_NAME);
  BLEAdvertising *pAdv = BLEDevice::getAdvertising();

  // Build iBeacon payload
  BLEBeacon beacon;
  beacon.setManufacturerId(0x4C00);  // Apple company ID — required for iBeacon
  BLEUUID bleUUID = BLEUUID(ROOM_UUID);
  bleUUID = bleUUID.to128();
  // Pass true to reverse the little-endian internal byte array to big-endian iBeacon packet order
  beacon.setProximityUUID(BLEUUID(bleUUID.getNative()->uuid.uuid128, 16, true));
  beacon.setMajor(ROOM_MAJOR);
  beacon.setMinor(ROOM_MINOR);
  beacon.setSignalPower(MEASURED_POWER);

  BLEAdvertisementData advData;
  advData.setFlags(0x06);  // LE General Discoverable + BR/EDR not supported

  String payload = "";
  payload += (char)26;    // AD length
  payload += (char)0xFF;  // AD type: manufacturer specific
  payload += beacon.getData();
  advData.addData(payload);

  pAdv->setAdvertisementData(advData);
  pAdv->setMinInterval(160);  // 160 × 0.625ms = 100ms
  pAdv->setMaxInterval(160);

  // Start once — never stop/restart (prevents crashes)
  pAdv->start();

  Serial.println("Advertising started — beacon is live.");
  Serial.println("Heartbeat every 5s. If this stops, the board crashed.");
}

void loop() {
  // BLE stack runs on its own FreeRTOS tasks — we don't touch it here.
  // Just print a heartbeat so you can confirm the board is alive.
  Serial.printf("[alive] uptime=%lus\n", millis() / 1000);
  delay(5000);
}
