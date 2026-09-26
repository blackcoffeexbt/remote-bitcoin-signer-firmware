#pragma once
#include <Arduino.h>
namespace Engine {
struct Message {
    String type, text, data, id;
};
bool start();
bool send(const String &type, const String &text = "", const String &data = "",
          const String &id = "");
Message *take();
} // namespace Engine
