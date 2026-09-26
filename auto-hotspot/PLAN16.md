# Plan: Auto Hotspot on Bluetooth Car Connection (Android 16)

## Context

The goal is a personal-use Android app (sideloaded APK, not Play Store) that automatically enables Wi-Fi tethering (internet-sharing hotspot) when the phone connects to a car via Bluetooth, and disables it on disconnect. Target: Android 16.

On Android 16, Google killed the reflection-based `ConnectivityManager.startTethering()` by moving it to `TetheringManager` with `TETHER_PRIVILEGED` (system-only). There is **no public API** for third-party apps to toggle tethering. Since the app is sideloaded (no Play Store policy restrictions), we use an **Accessibility Service** to programmatically tap the Hotspot Quick Settings tile — the same approach used by existing apps like WiFi Auto Hotspot and Auto Tethering.

## How the Accessibility Service Approach Works

1. The app registers an `AccessibilityService` that the user enables once in Settings → Accessibility.
2. When triggered by a Bluetooth connection, the service:
   - Calls `performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)` to pull down the Quick Settings panel
   - Traverses the accessibility node tree to find the "Hotspot" tile via `findAccessibilityNodeInfosByText()`
   - Performs `ACTION_CLICK` on the tile node
   - Calls `performGlobalAction(GLOBAL_ACTION_BACK)` to close the panel
3. Total execution: ~2 seconds, brief screen flicker.
4. The tile label varies by OEM/language ("Hotspot", "Mobile Hotspot", "Personal Hotspot", "Wi-Fi Hotspot") — we use fuzzy matching against a list of known labels.

## Tech Stack

- **Language:** Kotlin
- **UI:** Jetpack Compose + Material 3
- **Build:** Gradle with Kotlin DSL, Android Gradle Plugin
- **Min SDK:** 26 (Android 8) / **Target SDK:** 36 (Android 16)
- **Architecture:** Single-activity MVVM (ViewModel + StateFlow)
- **No DexMaker needed** (unlike the Android 15 reflection approach)

## Project Structure

```
auto-hotspot/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/gigacode/autohotspot/
│       │   ├── MainActivity.kt
│       │   ├── MainViewModel.kt
│       │   ├── bluetooth/
│       │   │   ├── BluetoothConnectionReceiver.kt
│       │   │   └── BluetoothDeviceManager.kt
│       │   ├── hotspot/
│       │   │   └── HotspotToggleService.kt    # AccessibilityService that clicks the QS tile
│       │   ├── service/
│       │   │   └── AutoHotspotService.kt      # Foreground service for lifecycle management
│       │   ├── data/
│       │   │   └── PreferencesManager.kt
│       │   └── ui/
│       │       ├── theme/Theme.kt
│       │       ├── SetupScreen.kt             # Permissions + accessibility service setup
│       │       ├── DeviceSelectionScreen.kt
│       │       └── StatusScreen.kt
│       └── res/
│           ├── xml/
│           │   ├── accessibility_service_config.xml
│           │   └── backup_rules.xml
│           └── values/
│               └── strings.xml
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

## Implementation Steps

### Step 1: Project Scaffolding
Create a new Android project under `auto-hotspot/` with Gradle Kotlin DSL, Jetpack Compose, and Material 3. No DexMaker dependency needed — the accessibility approach uses only standard Android APIs.

### Step 2: Bluetooth Detection — `BluetoothConnectionReceiver`
Same as Android 15 plan:
- Static `BroadcastReceiver` in manifest for `ACTION_ACL_CONNECTED` and `ACTION_ACL_DISCONNECTED` (implicit broadcast exemption list — delivered even when app is killed).
- On receive: extract `BluetoothDevice`, compare MAC against stored selection.
- If match on connect: start `AutoHotspotService` with action `ACTION_ENABLE`.
- If match on disconnect: send `ACTION_DISABLE` to `AutoHotspotService`.

### Step 3: Hotspot Control — `HotspotToggleService` (AccessibilityService)

This is the key difference from the Android 15 plan. The service:

```kotlin
class HotspotToggleService : AccessibilityService() {
    // Called by AutoHotspotService when BT triggers
    // 1. performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)
    // 2. Wait ~500ms for QS panel to render
    // 3. rootInActiveWindow → traverse node tree
    // 4. Find hotspot tile by matching text against known labels:
    //    listOf("Hotspot", "Mobile Hotspot", "Personal Hotspot",
    //           "Wi-Fi Hotspot", "Точка доступа", ...)
    // 5. Check current tile state (on/off) to avoid double-toggling
    // 6. performAction(ACTION_CLICK) on the tile
    // 7. Wait ~500ms, then performGlobalAction(GLOBAL_ACTION_BACK)
}
```

Communication between `AutoHotspotService` and `HotspotToggleService`: use a singleton object with a `StateFlow<ToggleRequest?>` that `HotspotToggleService` observes. When a request arrives, it performs the QS tile click sequence.

**Accessibility service config** (`res/xml/accessibility_service_config.xml`):
```xml
<accessibility-service
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged|typeWindowContentChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:canRetrieveWindowContent="true"
    android:notificationTimeout="100"
    android:settingsActivity="com.gigacode.autohotspot.MainActivity" />
```

### Step 4: Foreground Service — `AutoHotspotService`
- `foregroundServiceType="connectedDevice"` in manifest.
- Started by `BluetoothConnectionReceiver` when target car connects.
- Sends toggle request to `HotspotToggleService` (enable on connect, disable on disconnect).
- Shows a persistent notification with hotspot status and a manual toggle action.
- Stops self after hotspot is disabled and car is disconnected.

### Step 5: UI — Setup & Device Selection

Three screens:

1. **SetupScreen** — First-launch guided setup:
   - Check and request runtime permissions (BLUETOOTH_CONNECT, POST_NOTIFICATIONS)
   - Check WRITE_SETTINGS special permission → launch system settings if not granted
   - Check if `HotspotToggleService` is enabled in Accessibility settings → show button to open Settings → Accessibility with instructions
   - Check battery optimization exemption → prompt to disable
   - Green checkmarks next to each completed step

2. **DeviceSelectionScreen** — Lists paired Bluetooth devices, user taps to select trigger device. MAC stored in SharedPreferences.

3. **StatusScreen** — Shows: monitoring active/inactive, accessibility service status, hotspot on/off, connected device name. Master enable/disable toggle.

### Step 6: Permissions Flow
Request at runtime on first launch:
1. `BLUETOOTH_CONNECT` (runtime permission)
2. `POST_NOTIFICATIONS` (runtime permission, Android 13+)
3. `WRITE_SETTINGS` (special permission — `Settings.ACTION_MANAGE_WRITE_SETTINGS`)
4. **Accessibility Service** — user must manually enable in Settings → Accessibility (cannot be done programmatically). The app opens the correct settings page and shows instructions.
5. Battery optimization exemption — `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`

### Step 7: Boot Receiver
`RECEIVE_BOOT_COMPLETED` to restart `AutoHotspotService` after reboot.

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

<!-- Accessibility Service for toggling hotspot QS tile -->
<service android:name=".hotspot.HotspotToggleService"
    android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
    android:exported="false">
    <intent-filter>
        <action android:name="android.accessibilityservice.AccessibilityService" />
    </intent-filter>
    <meta-data
        android:name="android.accessibilityservice"
        android:resource="@xml/accessibility_service_config" />
</service>

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

## Android 16 Specific Considerations

1. **Advanced Protection Mode** — If the user enables this, Android revokes accessibility service permissions from non-`isAccessibilityTool` apps. The user must not enable Advanced Protection Mode for this app to work. The SetupScreen should warn about this.
2. **Quick Settings tile label** — The hotspot tile text varies by OEM skin (Samsung One UI, Pixel, etc.) and locale. The service should try multiple known labels and fall back to traversing all tiles looking for hotspot-related content descriptions.
3. **Screen state** — The QS panel can only be opened when the screen is on. If the screen is off, the service needs to wake the screen first using `PowerManager.newWakeLock()` with `ACQUIRE_CAUSES_WAKEUP`. After toggling, release the wake lock so the screen turns off again.
4. **Foreground service restrictions** — Android 16 restricts launching foreground services from background via `BOOT_COMPLETED` for some types. `connectedDevice` type is still allowed when triggered by a Bluetooth broadcast receiver (exempt implicit broadcast).

## Verification

1. **Build:** `./gradlew assembleDebug` — should produce APK without errors
2. **Install:** `adb install app/build/outputs/apk/debug/app-debug.apk`
3. **Setup test:**
   - Open app → complete guided setup (permissions + accessibility service)
   - Select car's Bluetooth device
4. **Test flow:**
   - Disconnect Bluetooth from car, then reconnect
   - Verify: screen briefly wakes → QS panel appears → hotspot tile is clicked → QS closes → hotspot is now on
   - Disconnect Bluetooth from car
   - Verify: same sequence toggles hotspot off
5. **Reboot test:** Reboot phone, connect to car BT, verify hotspot enables without opening the app
6. **Edge cases:**
   - Test with screen locked (should wake screen, toggle, re-lock)
   - Test when hotspot is already in the desired state (should not double-toggle)
   - Test rapid connect/disconnect (should debounce)
   - Test with different QS tile layouts (hotspot tile not on first page of QS)

