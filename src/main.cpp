#include "device_ui.h"
#include "display.h"
#include "engine.h"
#include "wallet.h"
#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_heap_caps.h>
#include <utility/trezor/bip39.h>
namespace {
lv_obj_t *page = nullptr, *keyboard = nullptr, *statusLabel = nullptr;
lv_obj_t *input1 = nullptr, *input2 = nullptr, *input3 = nullptr;
String phrase, requestId;
unsigned backupWord = 1;
String backupChoices[4];
bool configured = false;
void home(const String &text = "");
void label(const String &text) {
    DeviceUI::label(page, text.c_str());
}
void screen(const String &title) {
    if (keyboard) {
        lv_obj_del(keyboard);
        keyboard = nullptr;
    }
    page = DeviceUI::screen(title.c_str());
    statusLabel = nullptr;
    input1 = input2 = input3 = nullptr;
    Display::turnOnBacklight();
    Display::resetBacklightTimeout();
}
void status(const String &text, bool error = false) {
    if (!statusLabel)
        statusLabel = DeviceUI::label(page, text.c_str());
    DeviceUI::statusStyle(statusLabel, error);
    lv_label_set_text(statusLabel, text.c_str());
}
void button(const char *name, lv_event_cb_t callback,
            DeviceUI::Tone tone = DeviceUI::Tone::Primary) {
    auto b = DeviceUI::button(page, name, tone);
    lv_obj_add_event_cb(b, callback, LV_EVENT_CLICKED, nullptr);
}
void navigation(const char *name, const char *detail, const char *icon, lv_event_cb_t callback) {
    auto b = DeviceUI::navigation(page, name, detail, icon);
    lv_obj_add_event_cb(b, callback, LV_EVENT_CLICKED, nullptr);
}
static const char *pinKeys[] = {
    "1", "2", "3", "\n", "4", "5", "6", "\n", "7", "8", "9", "\n", LV_SYMBOL_BACKSPACE,
    "0", " ", ""};
static const lv_btnmatrix_ctrl_t pinControls[] = {
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 | LV_BTNMATRIX_CTRL_HIDDEN | LV_BTNMATRIX_CTRL_DISABLED};
lv_obj_t *input(const char *hint, bool secret = false, bool multiline = false, bool pin = false) {
    if (pin)
        DeviceUI::label(page, hint, &lv_font_montserrat_14, DeviceUI::muted);
    auto t = lv_textarea_create(page);
    lv_textarea_set_one_line(t, !multiline);
    lv_textarea_set_password_mode(t, secret);
    lv_textarea_set_placeholder_text(t, pin ? (secret ? "6-32 digits" : "0") : hint);
    DeviceUI::inputStyle(t, pin, secret);
    lv_textarea_set_max_length(t, pin ? 32 : (multiline ? 600 : 100));
    if (pin)
        lv_textarea_set_accepted_chars(t, "0123456789");
    lv_obj_add_event_cb(
        t,
        [](lv_event_t *e) {
            auto target = lv_event_get_target(e);
            if (!keyboard) {
                keyboard = lv_keyboard_create(lv_scr_act());

                lv_obj_add_event_cb(
                    keyboard,
                    [](lv_event_t *event) {
                        if (lv_event_get_code(event) == LV_EVENT_VALUE_CHANGED) {
                            // Mode changes reset LVGL's control map.
                            lv_btnmatrix_set_btn_ctrl_all(keyboard,
                                                          LV_BTNMATRIX_CTRL_NO_REPEAT |
                                                              LV_BTNMATRIX_CTRL_CLICK_TRIG);
                            return;
                        }
                        if (lv_event_get_code(event) != LV_EVENT_READY &&
                            lv_event_get_code(event) != LV_EVENT_CANCEL)
                            return;
                        // Numeric entry stays open until a page action. A drifting release
                        // must never activate Done and dismiss the keypad mid-PIN.
                        if (lv_keyboard_get_mode(keyboard) == LV_KEYBOARD_MODE_NUMBER)
                            return;
                        lv_obj_del(keyboard);
                        keyboard = nullptr;
                        lv_obj_set_height(page, DeviceUI::height);
                    },
                    LV_EVENT_ALL, nullptr);
            }
            const bool numeric = lv_event_get_user_data(e) != nullptr;
            DeviceUI::keyboardStyle(keyboard, numeric);
            if (numeric) {
                // Collapse introductory copy while typing; keep both PIN fields and actions.
                for (uint32_t i = 0; i < lv_obj_get_child_cnt(page); i++) {
                    if (!lv_obj_check_type(lv_obj_get_child(page, i), &lv_textarea_class))
                        continue;
                    for (uint32_t j = 0; j + 1 < i; j++)
                        lv_obj_add_flag(lv_obj_get_child(page, j), LV_OBJ_FLAG_HIDDEN);
                    break;
                }
            }
            lv_obj_set_height(page, DeviceUI::height - (numeric ? DeviceUI::numericKeyboardHeight
                                                                : DeviceUI::textKeyboardHeight));
            if (numeric)
                lv_keyboard_set_map(keyboard, LV_KEYBOARD_MODE_NUMBER, pinKeys, pinControls);
            lv_keyboard_set_mode(keyboard,
                                 numeric ? LV_KEYBOARD_MODE_NUMBER : LV_KEYBOARD_MODE_TEXT_LOWER);
            lv_btnmatrix_set_btn_ctrl_all(keyboard, LV_BTNMATRIX_CTRL_NO_REPEAT |
                                                        LV_BTNMATRIX_CTRL_CLICK_TRIG);
            auto previous = lv_keyboard_get_textarea(keyboard);
            if (previous && previous != target)
                lv_obj_clear_state(previous, LV_STATE_FOCUSED);
            lv_keyboard_set_textarea(keyboard, target);
            lv_obj_add_state(target, LV_STATE_FOCUSED);
            lv_obj_update_layout(page);
            // Keep the next field or action reachable above the larger keypad.
            for (uint32_t i = lv_obj_get_index(target) + 1; i < lv_obj_get_child_cnt(page); i++) {
                auto next = lv_obj_get_child(page, i);
                if (lv_obj_check_type(next, &lv_textarea_class) ||
                    lv_obj_check_type(next, &lv_btn_class)) {
                    lv_obj_scroll_to_view(next, LV_ANIM_OFF);
                    break;
                }
            }
            lv_obj_scroll_to_view(target, LV_ANIM_OFF);
        },
        LV_EVENT_CLICKED, pin ? reinterpret_cast<void *>(1) : nullptr);
    return t;
}
String value(lv_obj_t *t) {
    return String(lv_textarea_get_text(t));
}
bool send(const String &type, const String &text = "", const String &data = "",
          const String &id = "") {
    if (!Engine::send(type, text, data, id)) {
        status("Busy, please try again");
        return false;
    }
    const bool checkingPin = type == "settings_unlock" || type == "settings_create" ||
                             type == "unlock";
    if (checkingPin && keyboard) {
        lv_obj_del(keyboard);
        keyboard = nullptr;
        lv_obj_set_height(page, DeviceUI::height);
    }
    for (uint32_t i = 0; i < lv_obj_get_child_cnt(page); i++) {
        auto child = lv_obj_get_child(page, i);
        if (lv_obj_check_type(child, &lv_btn_class) ||
            (checkingPin && lv_obj_check_type(child, &lv_textarea_class)))
            lv_obj_add_state(child, LV_STATE_DISABLED);
    }
    if (keyboard)
        lv_obj_add_state(keyboard, LV_STATE_DISABLED);
    if (type == "generate")
        status("Generating your recovery phrase...");
    else if (type == "create")
        status("Creating your wallet...");
    else if (type == "unlock")
        status("Unlocking wallet with your PIN...");
    else if (type == "settings_unlock")
        status("Verifying PIN... Please wait.");
    else if (type == "settings_create")
        status("Saving PIN... Please wait.");
    else if (type == "network_setup")
        status("Starting setup Wi-Fi access point...");
    else if (type == "network_cancel")
        status("Closing setup Wi-Fi...");
    else if (type == "pair_code")
        status("Creating browser pairing code...");
    else if (type == "clients")
        status("Loading paired browsers...");
    else if (type == "revoke")
        status("Revoking browser access...");
    else if (type == "lock")
        status("Locking wallet and clearing keys...");
    else if (type == "approve")
        status("Processing your approval...");
    else if (type == "reject")
        status("Rejecting request and notifying browser...");
    if (checkingPin && statusLabel)
        lv_obj_scroll_to_view(statusLabel, LV_ANIM_OFF);
    return true;
}
void pinSetup() {
    screen("Choose wallet PIN");
    label("6-32 digits. Needed for each signing request. Back up the recovery phrase before "
          "continuing.");
    input1 = input("Wallet decryption PIN", true, false, true);
    input2 = input("Confirm PIN", true, false, true);
    button("Save wallet", [](lv_event_t *) {
        String pin = value(input1);
        if (pin != value(input2) || !Wallet::pinValid(pin)) {
            status("Use matching PINs of 6-32 digits", true);
            return;
        }
        if (!send("create", phrase, pin)) {
            Wallet::wipe(pin);
            return;
        }
        Wallet::wipe(pin);
        Wallet::wipe(phrase);
        lv_textarea_set_text(input1, "");
        lv_textarea_set_text(input2, "");
    });
}
String wordAt(int n) {
    int start = 0;
    for (int i = 1; i < n; i++) {
        start = phrase.indexOf(' ', start) + 1;
    }
    int end = phrase.indexOf(' ', start);
    return end < 0 ? phrase.substring(start) : phrase.substring(start, end);
}
void verifySeed(unsigned word = 1) {
    backupWord = word;
    screen("Verify backup - word " + String(word) + " of 12");
    label("Choose this word from your written backup.");
    backupChoices[0] = wordAt(word);
    // Distinct dictionary decoys also work when the recovery phrase repeats a word.
    const auto dictionary = mnemonic_wordlist();
    for (unsigned i = 1; i < 4; i++) {
        bool duplicate;
        do {
            backupChoices[i] = dictionary[esp_random() % 2048];
            duplicate = false;
            for (unsigned j = 0; j < i; j++)
                duplicate |= backupChoices[i] == backupChoices[j];
        } while (duplicate);
    }
    for (unsigned i = 3; i > 0; i--)
        std::swap(backupChoices[i], backupChoices[esp_random() % (i + 1)]);
    for (unsigned i = 0; i < 4; i++) {
        auto b = DeviceUI::button(page, backupChoices[i].c_str(), DeviceUI::Tone::Secondary);
        lv_obj_add_event_cb(
            b,
            [](lv_event_t *e) {
                const auto selection =
                    static_cast<unsigned>(reinterpret_cast<uintptr_t>(lv_event_get_user_data(e)));
                if (backupChoices[selection] != wordAt(backupWord)) {
                    status("Incorrect word", true);
                    return;
                }
                for (auto &choice : backupChoices)
                    Wallet::wipe(choice);
                if (backupWord < 12)
                    verifySeed(backupWord + 1);
                else
                    pinSetup();
            },
            LV_EVENT_CLICKED, reinterpret_cast<void *>(static_cast<uintptr_t>(i)));
    }
}
void settingsMenu(const String &text = "") {
    screen("Settings");
    DeviceUI::brand(page);
    if (text.length())
        label(text);
    navigation("Network", "Wi-Fi and Nostr relays", LV_SYMBOL_WIFI,
               [](lv_event_t *) { send("network_setup"); });
    navigation("Auto signing policies", "Transaction and daily limits", LV_SYMBOL_OK,
               [](lv_event_t *) { send("auto_settings"); });
    if (Wallet::exists()) {
        navigation("Connect", "Connect a remote control", LV_SYMBOL_PLUS,
                   [](lv_event_t *) { send("pair_code"); });
        navigation("Paired browsers", "Manage connections", LV_SYMBOL_LIST,
                   [](lv_event_t *) { send("clients"); });
    }
    button(Wallet::exists() ? "Close Settings" : "Continue wallet setup",
           [](lv_event_t *) { send("settings_close"); });
}
void settingsPin(bool create, bool migration = false, const String &text = "") {
    screen(create      ? "Choose settings PIN"
           : migration ? "Existing device upgrade"
                       : "Unlock Settings");
    label(
        create ? "Choose a separate settings PIN, 6-32 digits. This does not decrypt your wallet."
        : migration
            ? "Enter the existing wallet PIN once to authorize creating your separate settings PIN."
            : "Enter your settings PIN");
    if (text.length())
        label(text);
    input1 = input(create      ? "New settings PIN"
                   : migration ? "Wallet PIN (one time)"
                               : "Settings PIN",
                   true, false, true);
    if (create) {
        input2 = input("Confirm settings PIN", true, false, true);
        button("Save settings PIN", [](lv_event_t *) {
            String pin = value(input1), confirmation = value(input2);
            bool valid = Wallet::pinValid(pin) && pin == confirmation;
            Wallet::wipe(confirmation);
            if (!valid) {
                Wallet::wipe(pin);
                status("Use matching PINs of 6-32 digits", true);
                return;
            }
            send("settings_create", pin);
            Wallet::wipe(pin);
            lv_textarea_set_text(input1, "");
            lv_textarea_set_text(input2, "");
        });
    } else if (migration) {
        button("Verify existing wallet PIN", [](lv_event_t *) {
            String pin = value(input1);
            send("unlock", pin);
            Wallet::wipe(pin);
            lv_textarea_set_text(input1, "");
        });
    } else {
        button("Unlock Settings", [](lv_event_t *) {
            String pin = value(input1);
            send("settings_unlock", pin);
            Wallet::wipe(pin);
            lv_textarea_set_text(input1, "");
        });
    }
    if (!create || Wallet::exists())
        button("Cancel", [](lv_event_t *) { send("settings_close"); }, DeviceUI::Tone::Secondary);
}
void autoSettings(const String &text, const String &message) {
    DynamicJsonDocument d(512);
    deserializeJson(d, text);
    screen("Auto Signing Policies");
    label("Wallet PIN is always required. Below both limits, touchscreen approval is skipped. 0 "
          "disables it.");
    input1 = input("Approve transactions under (sats)", false, false, true);
    lv_textarea_set_max_length(input1, 16);
    lv_textarea_set_text(input1, String(d["under"].as<unsigned long long>()).c_str());
    input2 = input("Daily allowance (sats / UTC day)", false, false, true);
    lv_textarea_set_max_length(input2, 16);
    lv_textarea_set_text(input2, String(d["daily"].as<unsigned long long>()).c_str());
    label("Counts recipients plus fees, excluding change. Above either limit: review and approve "
          "on screen.");
    if (message.length())
        label(message);
    button("Save limits", [](lv_event_t *) { send("auto_save", value(input1), value(input2)); });
    button(
        "Back to Settings", [](lv_event_t *) { send("settings_open"); }, DeviceUI::Tone::Secondary);
}
void lockScreen(const String &text) {
    screen("Ready to sign");
    DeviceUI::brand(page, true);
    auto badge = DeviceUI::label(page, "WALLET LOCKED", &lv_font_montserrat_14, DeviceUI::mint);
    DeviceUI::statusStyle(badge);
    if (text.length())
        label(text);
    DeviceUI::label(page,
                    WiFi.status() == WL_CONNECTED ? LV_SYMBOL_WIFI "  Wi-Fi connected"
                                                  : LV_SYMBOL_WIFI "  Connecting to Wi-Fi...",
                    &lv_font_montserrat_14, DeviceUI::muted);
    button("Settings", [](lv_event_t *) { send("settings_open"); }, DeviceUI::Tone::Secondary);
}
void welcome() {
    screen("Welcome to Argus");
    DeviceUI::brand(page, true);
    label("Create a new wallet or restore a recovery phrase. This prototype only signs Testnet4 "
          "transactions.");
    button("Generate wallet", [](lv_event_t *) { send("generate"); });
    button("Restore wallet", [](lv_event_t *) {
        screen("Restore recovery phrase");
        label("Enter 12 or 24 words. No passphrase.");
        input1 = input("Recovery phrase", true, true);
        button("Continue", [](lv_event_t *) {
            phrase = value(input1);
            phrase.trim();
            int words = 1;
            for (char c : phrase)
                if (c == ' ')
                    words++;
            if ((words != 12 && words != 24) || !checkMnemonic(phrase)) {
                status("Invalid recovery phrase");
                Wallet::wipe(phrase);
                return;
            }
            pinSetup();
        });
        button(
            "Cancel",
            [](lv_event_t *) {
                Wallet::wipe(phrase);
                welcome();
            },
            DeviceUI::Tone::Secondary);
    });
    button("Settings", [](lv_event_t *) { send("settings_open"); }, DeviceUI::Tone::Secondary);
}
void home(const String &text) {
    configured = Wallet::exists();
    if (configured)
        lockScreen(text);
    else {
        welcome();
        if (text.length())
            status(text);
    }
}
void handle(Engine::Message &m) {
    if (m.type == "progress" || m.type == "status") {
        status(m.text);
        return; // Keep controls disabled until the worker finishes the command.
    }
    if (keyboard)
        lv_obj_clear_state(keyboard, LV_STATE_DISABLED);
    for (uint32_t i = 0; i < lv_obj_get_child_cnt(page); i++) {
        auto child = lv_obj_get_child(page, i);
        if (lv_obj_check_type(child, &lv_btn_class) ||
            lv_obj_check_type(child, &lv_textarea_class))
            lv_obj_clear_state(child, LV_STATE_DISABLED);
    }
    if (m.type == "settings") {
        settingsMenu(m.text);
    } else if (m.type == "settings_setup") {
        settingsPin(true);
    } else if (m.type == "settings_pin" || m.type == "settings_migrate") {
        settingsPin(false, m.type == "settings_migrate", m.text);
    } else if (m.type == "auto_settings") {
        autoSettings(m.text, m.data);
    } else if (m.type == "welcome") {
        configured = false;
        welcome();
    } else if (m.type == "locked") {
        configured = true;
        lockScreen(m.text);
    } else if (m.type == "pin_required") {
        requestId = m.id;
        screen("PIN required in LNbits");
        label("Enter your PIN in the paired LNbits wallet to unlock this signing request.");
        button(
            "Reject", [](lv_event_t *) { send("reject", "", "", requestId); },
            DeviceUI::Tone::Danger);
    } else if (m.type == "network_setup") {
        DynamicJsonDocument details(512);
        deserializeJson(details, m.text);
        String ssid = details["ssid"] | "", password = details["password"] | "";
        screen("Set up Wi-Fi and relays");
        label("Connect to this WiFi network from your phone or computer");
        label("Network: " + ssid + "\nPassword: " + password);
        label("Navigate to http://192.168.4.1 in a web browser to continue the setup.");
        String wifiCode = "WIFI:T:WPA;S:" + ssid + ";P:" + password + ";;";
        auto qr = lv_qrcode_create(page, 200, lv_color_black(), lv_color_white());
        lv_qrcode_update(qr, wifiCode.c_str(), wifiCode.length());
        button("Exit setup", [](lv_event_t *) { send("network_cancel"); });
        Wallet::wipe(password);
        Wallet::wipe(wifiCode);
    } else if (m.type == "home") {
        configured = Wallet::exists();
        home(m.text);
    } else if (m.type == "error" || m.type == "status")
        status(m.text, m.type == "error");
    else if (m.type == "seed") {
        phrase = m.text;
        screen("Write down your recovery phrase");
        String s;
        for (int i = 1; i <= 12; i++)
            s += String(i) + ". " + wordAt(i) + "\n";
        label(s);
        button("I wrote it down", [](lv_event_t *) { verifySeed(); });
        button(
            "Cancel",
            [](lv_event_t *) {
                Wallet::wipe(phrase);
                welcome();
            },
            DeviceUI::Tone::Secondary);
    } else if (m.type == "code") {
        screen("Connect remote client");
        label("Scan this QR code with your remote client to start the pairing process.");
        auto qr = lv_qrcode_create(page, 280, lv_color_black(), lv_color_white());
        lv_qrcode_update(qr, m.text.c_str(), m.text.length());
        button(
            "Back to Settings", [](lv_event_t *) { send("settings_open"); },
            DeviceUI::Tone::Secondary);
    } else if (m.type == "pair" || m.type == "review") {
        requestId = m.id;
        screen(m.type == "pair" ? "Authorize browser?" : "Review transaction");
        label(m.text);
        button("Approve", [](lv_event_t *) { send("approve", "", "", requestId); });
        button(
            "Reject", [](lv_event_t *) { send("reject", "", "", requestId); },
            DeviceUI::Tone::Danger);
    } else if (m.type == "clients") {
        screen("Paired browsers");
        if (!m.text.length())
            label("No browsers paired");
        int start = 0;
        while (start < int(m.text.length())) {
            int end = m.text.indexOf('\n', start);
            if (end < 0)
                end = m.text.length();
            String line = m.text.substring(start, end);
            start = end + 1;
            if (line.length() < 65)
                continue;
            auto key = new String(line.substring(0, 64));
            auto b = DeviceUI::button(
                page, ("Revoke " + line.substring(65) + "\n" + key->substring(0, 12)).c_str(),
                DeviceUI::Tone::Danger);
            lv_obj_add_event_cb(
                b,
                [](lv_event_t *e) {
                    auto key = static_cast<String *>(lv_event_get_user_data(e));
                    if (lv_event_get_code(e) == LV_EVENT_DELETE) {
                        delete key;
                        return;
                    }
                    if (lv_event_get_code(e) == LV_EVENT_CLICKED)
                        send("revoke", *key);
                },
                LV_EVENT_ALL, key);
        }
        button(
            "Back to Settings", [](lv_event_t *) { send("settings_open"); },
            DeviceUI::Tone::Secondary);
    }
}
} // namespace
void setup() {
    Serial.begin(115200);
    heap_caps_malloc_extmem_enable(4096);
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    Display::init();
    DeviceUI::init();
    screen("Starting Argus...");
    DeviceUI::brand(page, true);
    DeviceUI::label(page, "Remote access. Secret secured.", &lv_font_montserrat_14, DeviceUI::muted);
    lv_timer_handler();
    if (!Engine::start())
        status("Cannot start signing worker. Restart device.");
}
void loop() {
    if (auto m = Engine::take()) {
        handle(*m);
        Wallet::wipe(m->text);
        Wallet::wipe(m->data);
        delete m;
    }
    lv_timer_handler();
    Display::checkBacklightTimeout();
    delay(5);
}
