#!/usr/bin/env python3
"""Render the supplied vector logo to LVGL 8 RGB565 + alpha (rsvg-convert, ImageMagick)."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
svg = (root / 'assets/lnbits-logo.svg').read_text().replace('#FFFFFF', '#142D36')
png = subprocess.run(['rsvg-convert', '-w', '80', '-h', '24'], input=svg.encode(), capture_output=True, check=True).stdout
rgba = subprocess.run(['magick', 'png:-', '-depth', '8', 'rgba:-'], input=png, capture_output=True, check=True).stdout
assert len(rgba) == 80 * 24 * 4
pixels = []
for i in range(0, len(rgba), 4):
    r, g, b, a = rgba[i:i + 4]
    rgb = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    pixels.extend([rgb & 255, rgb >> 8, a])
rows = ['  ' + ', '.join(f'0x{x:02x}' for x in pixels[i:i + 24]) + ',' for i in range(0, len(pixels), 24)]
(root / 'src/lnbits_logo.h').write_text('''// Generated from assets/lnbits-logo.svg by scripts/generate-lnbits-logo.py.
#pragma once
#include <lvgl.h>
static const uint8_t lnbitsLogoPixels[] = {
''' + '\n'.join(rows) + '''
};
inline const lv_img_dsc_t &lnbitsLogoImage() {
    static const lv_img_dsc_t image = [] {
        lv_img_dsc_t d = {};
        d.header.cf = LV_IMG_CF_TRUE_COLOR_ALPHA;
        d.header.w = 80; d.header.h = 24;
        d.data_size = sizeof(lnbitsLogoPixels); d.data = lnbitsLogoPixels;
        return d;
    }();
    return image;
}
''')
