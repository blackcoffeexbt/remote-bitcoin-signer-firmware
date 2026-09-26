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
bool unlocked = false, configured = false;
void home(const String &text = "");
void label(const String &text) {
    auto obj = lv_label_create(page);
    lv_obj_set_width(obj, 280);
    lv_label_set_long_mode(obj, LV_LABEL_LONG_WRAP);
    lv_label_set_text(obj, text.c_str());
}
void screen(const String &title) {
    if (keyboard) {
        lv_obj_del(keyboard);
        keyboard = nullptr;
    }
    lv_obj_clean(lv_scr_act());
    page = lv_obj_create(lv_scr_act());
    lv_obj_set_size(page, 320, 480);
    lv_obj_set_flex_flow(page, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(page, 12, 0);
    label(title);
    statusLabel = nullptr;
    input1 = input2 = input3 = nullptr;
    Display::turnOnBacklight();
}
void status(const String &text) {
    if (!statusLabel) {
        statusLabel = lv_label_create(page);
        lv_obj_set_width(statusLabel, 280);
    }
    lv_label_set_text(statusLabel, text.c_str());
}
void button(const char *name, lv_event_cb_t callback) {
    auto b = lv_btn_create(page);
    lv_obj_set_width(b, 280);
    auto l = lv_label_create(b);
    lv_label_set_text(l, name);
    lv_obj_center(l);
    lv_obj_add_event_cb(b, callback, LV_EVENT_CLICKED, nullptr);
}
static const char *pinKeys[] = {
    "1", "2",          "3", "\n", "4", "5", "6", "\n", "7", "8", "9", "\n", LV_SYMBOL_BACKSPACE,
    "0", LV_SYMBOL_OK, ""};
static const lv_btnmatrix_ctrl_t pinControls[] = {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
lv_obj_t *input(const char *hint, bool secret = false, bool multiline = false, bool pin = false) {
    auto t = lv_textarea_create(page);
    lv_obj_set_width(t, 280);
    lv_textarea_set_one_line(t, !multiline);
    lv_textarea_set_password_mode(t, secret);
    lv_textarea_set_placeholder_text(t, hint);
    lv_textarea_set_max_length(t, pin ? 32 : (multiline ? 600 : 100));
    if (pin)
        lv_textarea_set_accepted_chars(t, "0123456789");
    lv_obj_add_event_cb(
        t,
        [](lv_event_t *e) {
            auto target = lv_event_get_target(e);
            if (!keyboard) {
                keyboard = lv_keyboard_create(lv_scr_act());
                lv_obj_set_size(keyboard, 320, 200);
                lv_obj_align(keyboard, LV_ALIGN_BOTTOM_MID, 0, 0);
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
                        lv_obj_del(keyboard);
                        keyboard = nullptr;
                        lv_obj_set_height(page, 480);
                    },
                    LV_EVENT_ALL, nullptr);
            }
            lv_obj_set_height(page, 280);
            const bool numeric = lv_event_get_user_data(e) != nullptr;
            if (numeric)
                lv_keyboard_set_map(keyboard, LV_KEYBOARD_MODE_NUMBER, pinKeys, pinControls);
            lv_keyboard_set_mode(keyboard,
                                 numeric ? LV_KEYBOARD_MODE_NUMBER : LV_KEYBOARD_MODE_TEXT_LOWER);
            lv_btnmatrix_set_btn_ctrl_all(keyboard, LV_BTNMATRIX_CTRL_NO_REPEAT |
                                                        LV_BTNMATRIX_CTRL_CLICK_TRIG);
            lv_keyboard_set_textarea(keyboard, target);
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
    for (uint32_t i = 0; i < lv_obj_get_child_cnt(page); i++) {
        auto child = lv_obj_get_child(page, i);
        if (lv_obj_check_type(child, &lv_btn_class))
            lv_obj_add_state(child, LV_STATE_DISABLED);
    }
    if (type == "generate")
        status("Generating your recovery phrase...");
    else if (type == "create")
        status("Creating your wallet...");
    else if (type == "unlock")
        status("Unlocking wallet with your PIN...");
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
    return true;
}
void pinSetup() {
    screen("Choose PIN");
    label("6-32 digits. Needed for each signing request. Back up the recovery phrase before "
          "continuing.");
    input1 = input("PIN", true, false, true);
    input2 = input("Confirm PIN", true, false, true);
    button("Save wallet", [](lv_event_t *) {
        String pin = value(input1);
        if (pin != value(input2) || !Wallet::pinValid(pin)) {
            status("Use matching PINs of 6-32 digits");
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
        auto b = lv_btn_create(page);
        lv_obj_set_size(b, 280, 44);
        auto l = lv_label_create(b);
        lv_label_set_text(l, backupChoices[i].c_str());
        lv_obj_center(l);
        lv_obj_add_event_cb(
            b,
            [](lv_event_t *e) {
                const auto selection =
                    static_cast<unsigned>(reinterpret_cast<uintptr_t>(lv_event_get_user_data(e)));
                if (backupChoices[selection] != wordAt(backupWord)) {
                    status("Incorrect word");
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
void network() {
    send("network_setup");
}
void lockScreen(const String &text) {
    unlocked = false;
    screen("Bitcoin signer - locked");
    label(text);
    label("Connects to Wi-Fi and relays automatically. Start signing in LNbits to enter your PIN.");
    button("Unlock settings", [](lv_event_t *) {
        screen("Unlock device settings");
        input1 = input("PIN", true, false, true);
        button("Unlock", [](lv_event_t *) {
            String pin = value(input1);
            send("unlock", pin);
            Wallet::wipe(pin);
            lv_textarea_set_text(input1, "");
        });
        button("Back", [](lv_event_t *) { home(); });
    });
}
void welcome() {
    screen("Testnet4 Bitcoin signer");
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
        button("Cancel", [](lv_event_t *) {
            Wallet::wipe(phrase);
            welcome();
        });
    });
    button("Network settings", [](lv_event_t *) { network(); });
}
void home(const String &text) {
    if (!unlocked) {
        if (configured)
            lockScreen(text);
        else {
            welcome();
            if (text.length())
                status(text);
        }
        return;
    }
    screen("Bitcoin signer - Testnet4");
    label(text);
    label(WiFi.status() == WL_CONNECTED ? "Wi-Fi connected" : "Wi-Fi disconnected");
    button("Pair a browser", [](lv_event_t *) { send("pair_code"); });
    button("Paired browsers", [](lv_event_t *) { send("clients"); });
    button("Network settings", [](lv_event_t *) { network(); });
    button("Lock", [](lv_event_t *) { send("lock"); });
}
void handle(Engine::Message &m) {
    if (m.type == "progress") {
        status(m.text);
        return; // Keep controls disabled until the worker finishes the command.
    }
    for (uint32_t i = 0; i < lv_obj_get_child_cnt(page); i++) {
        auto child = lv_obj_get_child(page, i);
        if (lv_obj_check_type(child, &lv_btn_class))
            lv_obj_clear_state(child, LV_STATE_DISABLED);
    }
    if (m.type == "welcome") {
        configured = false;
        welcome();
    } else if (m.type == "locked") {
        configured = true;
        lockScreen(m.text);
    } else if (m.type == "pin_required") {
        unlocked = false;
        requestId = m.id;
        screen("PIN required in LNbits");
        label("Enter your PIN in the paired LNbits client to unlock this signing request.");
        button("Reject", [](lv_event_t *) { send("reject", "", "", requestId); });
    } else if (m.type == "network_setup") {
        DynamicJsonDocument details(512);
        deserializeJson(details, m.text);
        String ssid = details["ssid"] | "", password = details["password"] | "";
        screen("Set up Wi-Fi and relays");
        label("On your phone or computer, join this setup Wi-Fi. Stay connected if it says no "
              "internet.");
        label("Network: " + ssid + "\nPassword: " + password);
        String wifiCode = "WIFI:T:WPA;S:" + ssid + ";P:" + password + ";;";
        auto qr = lv_qrcode_create(page, 200, lv_color_black(), lv_color_white());
        lv_qrcode_update(qr, wifiCode.c_str(), wifiCode.length());
        label("Then open http://192.168.4.1\nSetup closes after 10 minutes.");
        button("Close setup Wi-Fi", [](lv_event_t *) { send("network_cancel"); });
        Wallet::wipe(password);
        Wallet::wipe(wifiCode);
    } else if (m.type == "home") {
        configured = Wallet::exists();
        unlocked = configured && (unlocked || m.text.startsWith("Unlocked"));
        home(m.text);
    } else if (m.type == "error" || m.type == "status")
        status(m.text);
    else if (m.type == "seed") {
        phrase = m.text;
        screen("Write down your recovery phrase");
        String s;
        for (int i = 1; i <= 12; i++)
            s += String(i) + ". " + wordAt(i) + "\n";
        label(s);
        button("I wrote it down", [](lv_event_t *) { verifySeed(); });
        button("Cancel", [](lv_event_t *) {
            Wallet::wipe(phrase);
            welcome();
        });
    } else if (m.type == "code") {
        screen("Pair browser - valid 3 minutes");
        label("Scan this in LNbits. Confirm the browser name and key on this device.");
        auto qr = lv_qrcode_create(page, 280, lv_color_black(), lv_color_white());
        lv_qrcode_update(qr, m.text.c_str(), m.text.length());
        label(m.text);
        button("Back", [](lv_event_t *) { home(); });
    } else if (m.type == "pair" || m.type == "review") {
        requestId = m.id;
        screen(m.type == "pair" ? "Authorize browser?" : "Review transaction");
        label(m.text);
        button("Approve", [](lv_event_t *) { send("approve", "", "", requestId); });
        button("Reject", [](lv_event_t *) { send("reject", "", "", requestId); });
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
            auto b = lv_btn_create(page);
            lv_obj_set_width(b, 280);
            auto l = lv_label_create(b);
            lv_label_set_text(
                l, ("Revoke " + line.substring(65) + "\n" + key->substring(0, 12)).c_str());
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
        button("Back", [](lv_event_t *) { home(); });
    }
}
} // namespace
void setup() {
    Serial.begin(115200);
    heap_caps_malloc_extmem_enable(4096);
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    Display::init();
    screen("Starting Bitcoin signer...");
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
