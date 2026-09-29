#pragma once

// Portrait orientation on both boards.
#define TFT_rot 0
#if defined(BOARD_LILYGO_AMOLED_TOUCH)
#define TFT_res_W 240
#define TFT_res_H 536
#else
#define TFT_res_W 320
#define TFT_res_H 480
#endif

#define Touch_X_min 0
#define Touch_X_max (TFT_res_W - 1)
#define Touch_Y_min 0
#define Touch_Y_max (TFT_res_H - 1)
