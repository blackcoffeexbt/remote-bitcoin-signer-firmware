#pragma once
#include "bitcoin_network.h"
#include <lvgl.h>
#include "argus_logo.h"
#include "lnbits_logo.h"

// Shared Argus theme styling for the 320 x 480 display.
namespace DeviceUI {
constexpr int width = 320, height = 480, inset = 16, contentWidth = width - inset * 2;
constexpr int numericKeyboardHeight = 240, textKeyboardHeight = 200;
inline uint32_t background = 0xF5F8F7, surface = 0xFFFFFF, raised = 0xE6F1EE;
inline uint32_t border = 0xD6E3E0, mint = 0x006C67, mintPressed = 0x005550;
inline uint32_t text = 0x142D36, muted = 0x506770, onAccent = 0xFFFFFF;
inline uint32_t danger = 0xA12D39, dangerSurface = 0xFCECEE;
enum class Tone { Primary, Secondary, Danger };

inline void init(bool dark = false) {
    background = dark ? 0x101C22 : 0xF5F8F7;
    surface = dark ? 0x1B2B32 : 0xFFFFFF;
    raised = dark ? 0x293E45 : 0xE6F1EE;
    border = dark ? 0x40575F : 0xD6E3E0;
    mint = dark ? 0x78DAC5 : 0x006C67;
    mintPressed = dark ? 0x50BCA7 : 0x005550;
    text = dark ? 0xEDF5F3 : 0x142D36;
    muted = dark ? 0xB0C4CB : 0x506770;
    onAccent = dark ? 0x102C28 : 0xFFFFFF;
    danger = dark ? 0xFFADB6 : 0xA12D39;
    dangerSurface = dark ? 0x442630 : 0xFCECEE;
    auto display = lv_disp_get_default();
    lv_disp_set_theme(display,
                      lv_theme_default_init(display, lv_color_hex(mint), lv_color_hex(raised), dark,
                                            &lv_font_montserrat_16));
}
inline lv_obj_t *label(lv_obj_t *parent, const char *value,
                       const lv_font_t *font = &lv_font_montserrat_16, uint32_t color = text) {
    auto obj = lv_label_create(parent);
    lv_obj_set_width(obj, contentWidth);
    lv_label_set_long_mode(obj, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_font(obj, font, 0);
    lv_obj_set_style_text_color(obj, lv_color_hex(color), 0);
    lv_obj_set_style_text_line_space(obj, 4, 0);
    lv_label_set_text(obj, value);
    return obj;
}
inline lv_obj_t *brand(lv_obj_t *parent, bool large = false) {
    auto row = lv_obj_create(parent);
    lv_obj_remove_style_all(row);
    lv_obj_set_size(row, contentWidth, large ? 110 : 44);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    auto image = lv_img_create(row);
    lv_img_set_src(image, &argusLogoImage());
    lv_img_set_zoom(image, large ? 256 : 107);
    lv_obj_align(image, LV_ALIGN_LEFT_MID, large ? 0 : -28, 0);
    auto name = label(row, "Argus", &lv_font_montserrat_28);
    lv_obj_set_width(name, 170);
    lv_obj_align(name, LV_ALIGN_LEFT_MID, large ? 110 : 54, 0);
    return row;
}
// Stacked endorsement for the splash and Settings; the compact form saves room
// for the settings controls on the device's small display.
inline lv_obj_t *endorsedBrand(lv_obj_t *parent, bool compact = false) {
    auto group = lv_obj_create(parent);
    lv_obj_remove_style_all(group);
    lv_obj_set_size(group, contentWidth, compact ? 94 : 190);
    lv_obj_clear_flag(group, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    if (compact) {
        auto heading = brand(group);
        lv_obj_set_width(heading, 158);
        lv_obj_align(heading, LV_ALIGN_TOP_MID, 0, 0);
    } else {
        auto mark = lv_img_create(group);
        lv_img_set_src(mark, &argusLogoImage());
        lv_obj_align(mark, LV_ALIGN_TOP_MID, 0, 0);
        auto name = label(group, "Argus", &lv_font_montserrat_28);
        lv_obj_set_style_text_align(name, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_align(name, LV_ALIGN_TOP_MID, 0, 100);
    }
    auto by = label(group, "by", &lv_font_montserrat_12, muted);
    lv_obj_set_style_text_align(by, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(by, LV_ALIGN_TOP_MID, 0, compact ? 48 : 142);
    auto logo = lv_img_create(group);
    lv_img_set_src(logo, &lnbitsLogoImage());
    lv_obj_align(logo, LV_ALIGN_TOP_MID, 0, compact ? 68 : 162);
    return group;
}
inline lv_obj_t *screen(const char *title) {
    lv_obj_clean(lv_scr_act());
    lv_obj_set_style_bg_color(lv_scr_act(), lv_color_hex(background), 0);
    auto page = lv_obj_create(lv_scr_act());
    lv_obj_remove_style_all(page);
    lv_obj_set_size(page, width, height);
    lv_obj_set_style_bg_color(page, lv_color_hex(background), 0);
    lv_obj_set_style_bg_opa(page, LV_OPA_COVER, 0);
    lv_obj_set_style_text_color(page, lv_color_hex(text), 0);
    lv_obj_set_style_text_font(page, &lv_font_montserrat_16, 0);
    lv_obj_set_style_pad_all(page, inset, 0);
    lv_obj_set_style_pad_row(page, 12, 0);
    lv_obj_set_flex_flow(page, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(page, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_scroll_dir(page, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(page, LV_SCROLLBAR_MODE_AUTO);
    lv_obj_set_style_bg_color(page, lv_color_hex(border), LV_PART_SCROLLBAR);
    lv_obj_set_style_width(page, 3, LV_PART_SCROLLBAR);
    lv_obj_set_style_radius(page, 2, LV_PART_SCROLLBAR);
    label(page, BitcoinNetwork::banner, &lv_font_montserrat_12, mint);
    label(page, title, &lv_font_montserrat_24);
    return page;
}
inline void buttonStyle(lv_obj_t *button, Tone tone = Tone::Primary) {
    lv_obj_set_width(button, contentWidth);
    lv_obj_set_height(button, LV_SIZE_CONTENT);
    lv_obj_set_style_min_height(button, 52, 0);
    lv_obj_set_style_radius(button, 14, 0);
    lv_obj_set_style_pad_all(button, 15, 0);
    lv_obj_set_style_shadow_width(button, 0, LV_STATE_DEFAULT);
    lv_obj_set_style_shadow_width(button, 0, LV_STATE_PRESSED);
    lv_obj_set_style_transform_width(button, 0, LV_STATE_PRESSED);
    lv_obj_set_style_transform_height(button, 0, LV_STATE_PRESSED);
    const auto fill = tone == Tone::Primary ? mint : tone == Tone::Danger ? dangerSurface : surface;
    const auto foreground = tone == Tone::Primary ? onAccent : tone == Tone::Danger ? danger : text;
    lv_obj_set_style_bg_color(button, lv_color_hex(fill), 0);
    lv_obj_set_style_bg_color(button, lv_color_hex(tone == Tone::Primary ? mintPressed : raised),
                              LV_STATE_PRESSED);
    lv_obj_set_style_text_color(button, lv_color_hex(foreground), 0);
    lv_obj_set_style_text_font(button, &lv_font_montserrat_18, 0);
    lv_obj_set_style_border_width(button, tone == Tone::Primary ? 0 : 1, 0);
    lv_obj_set_style_border_color(button, lv_color_hex(tone == Tone::Danger ? danger : border), 0);
    lv_obj_set_style_bg_color(button, lv_color_hex(raised), LV_STATE_DISABLED);
    lv_obj_set_style_text_color(button, lv_color_hex(muted), LV_STATE_DISABLED);
    lv_obj_set_style_opa(button, LV_OPA_60, LV_STATE_DISABLED);
}
inline lv_obj_t *button(lv_obj_t *parent, const char *name, Tone tone = Tone::Primary) {
    auto b = lv_btn_create(parent);
    buttonStyle(b, tone);
    auto caption = lv_label_create(b);
    lv_obj_set_width(caption, contentWidth - 32);
    lv_label_set_long_mode(caption, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_align(caption, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_text(caption, name);
    lv_obj_center(caption);
    return b;
}
inline lv_obj_t *navigation(lv_obj_t *parent, const char *title, const char *detail,
                            const char *icon) {
    auto b = lv_btn_create(parent);
    buttonStyle(b, Tone::Secondary);
    lv_obj_set_style_pad_all(b, 12, 0);
    lv_obj_set_style_pad_column(b, 12, 0);
    lv_obj_set_flex_flow(b, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(b, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    auto symbol = label(b, icon, &lv_font_montserrat_24, mint);
    lv_obj_set_width(symbol, 28);
    auto copy = lv_obj_create(b);
    lv_obj_remove_style_all(copy);
    lv_obj_clear_flag(copy, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_grow(copy, 1);
    lv_obj_set_height(copy, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(copy, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(copy, 5, 0);
    auto heading = label(copy, title, &lv_font_montserrat_18);
    lv_obj_set_width(heading, lv_pct(100));
    auto subtitle = label(copy, detail, &lv_font_montserrat_12, muted);
    lv_obj_set_width(subtitle, lv_pct(100));
    return b;
}
inline void inputStyle(lv_obj_t *field, bool numeric, bool secret) {
    lv_obj_set_width(field, contentWidth);
    lv_obj_set_style_radius(field, 14, 0);
    lv_obj_set_style_bg_color(field, lv_color_hex(surface), 0);
    lv_obj_set_style_bg_opa(field, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(field, lv_color_hex(border), 0);
    lv_obj_set_style_border_width(field, 1, 0);
    lv_obj_set_style_border_color(field, lv_color_hex(mint), LV_STATE_FOCUSED);
    lv_obj_set_style_border_width(field, 2, LV_STATE_FOCUSED);
    lv_obj_set_style_outline_width(field, 0, LV_STATE_FOCUSED);
    lv_obj_set_style_shadow_width(field, 0, 0);
    lv_obj_set_style_pad_all(field, 15, 0);
    lv_obj_set_style_text_font(field, numeric ? &lv_font_montserrat_28 : &lv_font_montserrat_18, 0);
    lv_obj_set_style_text_color(field, lv_color_hex(text), 0);
    lv_obj_set_style_text_color(field, lv_color_hex(muted), LV_PART_TEXTAREA_PLACEHOLDER);
    lv_obj_set_style_text_font(field, &lv_font_montserrat_16, LV_PART_TEXTAREA_PLACEHOLDER);
    lv_obj_set_style_text_letter_space(field, 0, LV_PART_TEXTAREA_PLACEHOLDER);
    lv_obj_set_style_text_align(field,
                                numeric && secret ? LV_TEXT_ALIGN_CENTER : LV_TEXT_ALIGN_LEFT, 0);
    lv_obj_set_style_text_letter_space(field, numeric && secret ? 4 : 0, 0);
    lv_obj_set_style_bg_color(field, lv_color_hex(mint), LV_PART_CURSOR);
    if (numeric) {
        lv_obj_set_height(field, 64);
        if (secret)
            lv_textarea_set_password_show_time(field, 0);
    }
}
inline void keyboardStyle(lv_obj_t *keyboard, bool numeric) {
    lv_obj_set_size(keyboard, width, numeric ? numericKeyboardHeight : textKeyboardHeight);
    lv_obj_align(keyboard, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_bg_color(keyboard, lv_color_hex(background), 0);
    lv_obj_set_style_bg_opa(keyboard, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(keyboard, 12, 0);
    lv_obj_set_style_pad_row(keyboard, 8, 0);
    lv_obj_set_style_pad_column(keyboard, 8, 0);
    lv_obj_set_style_border_width(keyboard, 1, 0);
    lv_obj_set_style_border_side(keyboard, LV_BORDER_SIDE_TOP, 0);
    lv_obj_set_style_border_color(keyboard, lv_color_hex(border), 0);
    lv_obj_set_style_radius(keyboard, 0, 0);
    lv_obj_set_style_radius(keyboard, 12, LV_PART_ITEMS);
    lv_obj_set_style_bg_color(keyboard, lv_color_hex(raised), LV_PART_ITEMS);
    lv_obj_set_style_bg_color(keyboard, lv_color_hex(mint), LV_PART_ITEMS | LV_STATE_PRESSED);
    lv_obj_set_style_text_color(keyboard, lv_color_hex(text), LV_PART_ITEMS);
    lv_obj_set_style_text_color(keyboard, lv_color_hex(onAccent), LV_PART_ITEMS | LV_STATE_PRESSED);
    lv_obj_set_style_text_font(keyboard, numeric ? &lv_font_montserrat_28 : &lv_font_montserrat_16,
                               LV_PART_ITEMS);
    lv_obj_set_style_border_width(keyboard, 0, LV_PART_ITEMS);
    lv_obj_set_style_shadow_width(keyboard, 0, LV_PART_ITEMS);
}
inline void statusStyle(lv_obj_t *obj, bool error = false) {
    lv_obj_set_width(obj, contentWidth);
    lv_obj_set_style_text_font(obj, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_line_space(obj, 4, 0);
    lv_obj_set_style_text_color(obj, lv_color_hex(error ? danger : mint), 0);
    lv_obj_set_style_bg_color(obj, lv_color_hex(error ? dangerSurface : surface), 0);
    lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(obj, 12, 0);
    lv_obj_set_style_pad_all(obj, 12, 0);
}
} // namespace DeviceUI
