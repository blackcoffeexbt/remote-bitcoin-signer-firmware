#pragma once

#if defined(BOARD_LILYGO_AMOLED_TOUCH)
// LilyGO AMOLED-Series: RM67162_AMOLED / AMOLED_191_TOUCH_PINS.
#define TFT_POWER 38
#define TFT_RST  17
#define TFT_CS   6
#define TFT_SCK  47
#define TFT_SDA0 18
#define TFT_SDA1 7
#define TFT_SDA2 48
#define TFT_SDA3 5
#define Touch_SDA  3
#define Touch_SCL  2
#define Touch_INT  21
#define Touch_ADDR 0x15
#else
// Pin configuration for JC3248W535 ESP32-S3 display module
// Display module
#define TFT_BL   1
#define TFT_CS   45
#define TFT_SCK  47
#define TFT_SDA0 21
#define TFT_SDA1 48
#define TFT_SDA2 40
#define TFT_SDA3 39

// Touch module
#define Touch_SDA  4
#define Touch_SCL  8
#define Touch_INT  3
#define Touch_ADDR 0x3B
#endif
