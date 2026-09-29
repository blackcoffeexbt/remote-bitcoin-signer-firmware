# LilyGO T-Display-S3 AMOLED Touch

This profile supports the original **1.91-inch, 240 × 536, QSPI Touch** model
with an RM67162 panel, CST816 touch controller, ESP32-S3, 16 MB flash and 8 MB
OPI PSRAM. The SPI/Plus models and other panel sizes need separate profiles.

## Build and network

```sh
pio run -e lilygo-t-display-s3-amoled-touch
```

The profile inherits the existing pinned toolchain, libraries, 16 MB partition
layout and safe application-only upload helper. Select Mainnet (`0`) or Testnet4
(`1`) in `[bitcoin] testnet4` before building. Network selection remains build-time
only. The board profile does not change custody, signing, PIN or broadcast policy.

## Hardware mapping

| Signal | GPIO |
| --- | --- |
| Panel/touch power enable (high) | 38 |
| Display reset | 17 |
| QSPI CS / clock | 6 / 47 |
| QSPI D0 / D1 / D2 / D3 | 18 / 7 / 48 / 5 |
| Touch SDA / SCL / interrupt | 3 / 2 / 21 |

Touch uses I²C address `0x15`, with no separate reset pin. RM67162 rotation 0 is
portrait. CST816 landscape coordinates are swapped and mirrored to match it;
coordinates outside the panel, including the capacitive home key, are ignored.
Invalid, short, multi-touch, lift and all-FF packets cannot supply a new touch
position. The controller is polled with automatic sleep disabled. Screen timeout
sets the AMOLED brightness register to zero while retaining power to touch.
The existing wake gesture consumption and settings/session timeouts remain active.

The shared UI uses board dimensions, vertical scrolling, and a 208-pixel pairing
QR on LilyGO. PIN and text keyboards retain their existing heights. Brightness
uses the RM67162 `0x51` register rather than a PWM backlight pin.

Pin and orientation references are LilyGO's
[Arduino_GFX example](https://github.com/Xinyuan-LilyGO/LilyGo-AMOLED-Series/blob/057d12b810a11445cbed92e9d1a97fab8590a694/examples/Arduino_GFX_HelloWorld/Arduino_GFX_HelloWorld.ino),
[board definitions](https://github.com/Xinyuan-LilyGO/LilyGo-AMOLED-Series/blob/057d12b810a11445cbed92e9d1a97fab8590a694/src/LilyGo_AMOLED.h),
and [rotation mapping](https://github.com/Xinyuan-LilyGO/LilyGo-AMOLED-Series/blob/057d12b810a11445cbed92e9d1a97fab8590a694/src/LilyGo_AMOLED.cpp).
These agree with the original board examples; the wiki's display pin table
currently differs, so it is not used for this profile.

## Installation

For an already provisioned Argus board with a valid OTA selection:

```sh
pio run -e lilygo-t-display-s3-amoled-touch -t upload --upload-port /dev/cu.usbmodem1101
```

Choose the actual connected port. This preserves the existing application-backup
and partition validation behavior. A factory board may require explicit initial
provisioning of the build's bootloader, partition table, OTA metadata and app;
the safe uploader deliberately refuses unrecognized layouts or missing OTA
selection. On a board whose partition table is already blank, use:

```sh
sh scripts/flash-erased.sh /dev/cu.usbmodem1101 lilygo-t-display-s3-amoled-touch
```

This checks that the partition table is blank and refuses to overwrite an existing
layout. It does not erase storage. No build command flashes or erases hardware.

## Checks

```sh
clang++ -std=c++17 -fsanitize=address,undefined tests/cst816-touch.cpp -o /tmp/cst816-touch-tests
/tmp/cst816-touch-tests
```

Physical acceptance still requires:

- Correct portrait image, colors and touch position at every corner and center.
- Single taps, repeated digits, held fingers, scrolling and the off-panel home key.
- PIN fields, restore keyboard, recovery words, full recipient addresses and
  approve/reject controls remaining reachable at the narrow width.
- Pairing and setup-Wi-Fi QR codes scanning with the mobile client.
- Brightness endpoints, timeout, a consumed wake gesture and saved preferences
  after restart, including a finger held down while waking.
- End-to-end request-bound approval/rejection and a user-confirmed client broadcast.

Do not enter real PINs or recovery words into diagnostics or logs. Boot success
and controller detection alone do not verify these physical interactions.
