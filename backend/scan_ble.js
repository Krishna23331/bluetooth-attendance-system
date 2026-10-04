/**
 * Quick BLE scan — run with:  node scan_ble.js
 * Scans for 10 seconds and lists all BLE advertisements,
 * highlighting any that look like the PACBAS iBeacon.
 */
const { execSync, spawn } = require('child_process');

const TARGET_UUID = '8ec76ea3-6668-48da-9866-75be8bc86f4d';
const TARGET_NAME = 'PACBAS';

console.log('🔍 Scanning for BLE devices for 10 seconds...\n');

// Use bluetoothctl via stdin/stdout (no sudo needed)
const bt = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'inherit'] });

const found = new Set();

bt.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    // Device discovery lines look like: [NEW] Device AA:BB:CC:DD:EE:FF Name
    const match = line.match(/\[NEW\] Device ([A-F0-9:]+)\s*(.*)/);
    if (match) {
      const mac = match[1];
      const name = match[2].trim();
      if (!found.has(mac)) {
        found.add(mac);
        const isTarget = name.includes(TARGET_NAME);
        const icon = isTarget ? '✅ PACBAS BEACON FOUND!' : '📡';
        console.log(`${icon}  ${mac}  "${name || '(no name)'}"`);
      }
    }
  }
});

// Start scan
bt.stdin.write('scan on\n');

setTimeout(() => {
  bt.stdin.write('scan off\n');
  bt.stdin.end();
  setTimeout(() => {
    if (found.size === 0) {
      console.log('\n❌ No BLE devices found at all — check that Bluetooth is on.');
    } else {
      const hasBeacon = [...found].some(mac => {
        // We can only match by name since bluetoothctl doesn't expose raw adv data
      });
      console.log(`\nTotal devices seen: ${found.size}`);
      console.log('\nIf PACBAS-Beacon-101-1 is NOT listed above:');
      console.log('  → Check ESP32 Serial Monitor for "Advertising started"');
      console.log('  → Make sure the ESP32 is powered and within ~10m');
    }
  }, 1000);
}, 10000);
