# Plan: Auto Hotspot on Bluetooth Car Connection (Android 15)

## Context

The goal is a personal-use Android app (sideloaded APK, not Play Store) that automatically enables Wi-Fi tethering (internet-sharing hotspot) when the phone connects to a car via Bluetooth, and disables it on disconnect. Target: Android 15 only.

This is feasible because the reflection-based `ConnectivityManager.startTethering()` API still works on Android 15 (it was killed in Android 16). Since the app is sideloaded, there are no Play Store policy restrictions.

## Tech Stack

- **Language:** Kotlin
- **UI:** Jetpack Compose + Material 3
- **Build:** Gradle with Kotlin DSL, Android Gradle Plugin
- **Min SDK:** 26 (Android 8) / **Target SDK:** 35 (Android 15)
- **Architecture:** Single-activity MVVM (ViewModel + StateFlow)

## Project Structure

```
auto-hotspot/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/gigacode/autohotspot/
│       │   ├── MainActivity.kt              # Single activity, Compose host
│       │   ├── MainViewModel.kt             # UI state management
│       │   ├── bluetooth/
│       │   │   ├── BluetoothConnectionReceiver.kt  # Static broadcast receiver
│       │   │   └── BluetoothDeviceManager.kt       # List paired devices, persist selection
│       │   ├── hotspot/
│       │   │   └── HotspotController.kt     # Reflection-based tethering toggle
│       │   ├── service/
│       │   │   └── AutoHotspotService.kt    # Foreground service for lifecycle management
│       │   ├── data/
│       │   │   └── PreferencesManager.kt    # SharedPreferences wrapper (selected device MAC)
│       │   └── ui/
│       │       ├── theme/Theme.kt
│       │       ├── DeviceSelectionScreen.kt # Pick which BT device triggers hotspot
│       │       └── StatusScreen.kt          # Current state, enable/disable toggle
│       └── res/
│           ├── xml/
│           │   └── backup_rules.xml
│           └── values/
│               └── strings.xml
├── build.gradle.kts                         # Root build file
├── settings.gradle.kts
└── gradle.properties
```

## Implementation Steps

### Step 1: Project Scaffolding
Create a new Android project under `auto-hotspot/` with Gradle Kotlin DSL, Jetpack Compose dependencies, and Material 3. Add DexMaker dependency for the reflection proxy.

### Step 2: Bluetooth Detection — `BluetoothConnectionReceiver`
- Static `BroadcastReceiver` registered in `AndroidManifest.xml` for `ACTION_ACL_CONNECTED` and `ACTION_ACL_DISCONNECTED` (both are on the implicit broadcast exemption list — delivered even when app is killed).
- On receive: extract `BluetoothDevice` from intent extras, compare MAC address against the user's stored selection.
- If match: start `AutoHotspotService` to toggle hotspot on/off.

### Step 3: Hotspot Control — `HotspotController`
Use reflection to call the hidden `ConnectivityManager.startTethering()` method:

```kotlin
// Key approach:
// 1. Get ConnectivityManager
// 2. Use reflection to find the hidden startTethering(int, boolean, OnStartTetheringCallback) method
// 3. Use DexMaker ProxyBuilder to create a dynamic proxy for the abstract OnStartTetheringCallback class
// 4. Call startTethering(TETHERING_WIFI=0, false, callbackProxy)
// 5. For stop: call stopTethering(TETHERING_WIFI=0)
```

Dependencies needed:
- `com.linkedin.dexmaker:dexmaker-dx:2.28.4` (for ProxyBuilder to subclass the hidden abstract callback)

Reference implementation: [spoton by Marco Gomiero](https://github.com/nicorsm/spoton) used this exact approach successfully through Android 15.

### Step 4: Foreground Service — `AutoHotspotService`
- `foregroundServiceType="connectedDevice"` in manifest.
- Started by `BluetoothConnectionReceiver` when the target car connects.
- Calls `HotspotController.enableTethering()` on start.
- Calls `HotspotController.disableTethering()` and stops self when car disconnects.
- Shows a persistent notification with hotspot status and a manual toggle action.

### Step 5: Device Selection UI
- `DeviceSelectionScreen`: Lists all paired Bluetooth devices via `BluetoothAdapter.getBondedDevices()`. User taps one to set it as the trigger device. MAC address stored in SharedPreferences.
- `StatusScreen`: Shows current state (monitoring active/inactive, hotspot on/off, connected device name). Toggle to enable/disable the automation.

### Step 6: Permissions Flow
Request at runtime on first launch:
1. `BLUETOOTH_CONNECT` (runtime permission, Android 12+)
2. `NEARBY_WIFI_DEVICES` (runtime permission, Android 13+)
3. `POST_NOTIFICATIONS` (runtime permission, Android 13+)
4. `WRITE_SETTINGS` (special permission — launch `Settings.ACTION_MANAGE_WRITE_SETTINGS`)
5. Battery optimization exemption — prompt user to disable via `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`

### Step 7: Boot Receiver
Register `RECEIVE_BOOT_COMPLETED` broadcast receiver to restart `AutoHotspotService` after device reboot, so monitoring resumes automatically.

## AndroidManifest.xml — Key Declarations

```xml
<!-- Permissions -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WRITE_SETTINGS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<!-- Static BroadcastReceiver for BT connect/disconnect -->
<receiver android:name=".bluetooth.BluetoothConnectionReceiver"
    android:exported="true">
    <intent-filter>
        <action android:name="android.bluetooth.device.action.ACL_CONNECTED" />
        <action android:name="android.bluetooth.device.action.ACL_DISCONNECTED" />
    </intent-filter>
</receiver>

<!-- Foreground service -->
<service android:name=".service.AutoHotspotService"
    android:foregroundServiceType="connectedDevice"
    android:exported="false" />

<!-- Boot receiver -->
<receiver android:name=".service.BootReceiver"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
    </intent-filter>
</receiver>
```

## Verification

1. **Build:** `./gradlew assembleDebug` — should produce APK without errors
2. **Install:** `adb install app/build/outputs/apk/debug/app-debug.apk`
3. **Test flow:**
   - Open app → grant all permissions → select car's Bluetooth device
   - Turn off Bluetooth, then turn on and connect to car
   - Verify hotspot automatically enables (check Settings → Hotspot)
   - Disconnect Bluetooth from car
   - Verify hotspot automatically disables
4. **Reboot test:** Reboot phone, connect to car BT, verify hotspot enables without opening the app
5. **Edge cases:** Test with Wi-Fi already on (hotspot should override), test rapid connect/disconnect cycles

