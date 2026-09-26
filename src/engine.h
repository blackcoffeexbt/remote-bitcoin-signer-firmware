#pragma once
#include <Arduino.h>
namespace Engine {
struct Message {
    String type, text, data, id;
};
bool start();
// Called from the UI task for physical touchscreen activity.
void noteActivity();
bool send(const String &type, const String &text = "", const String &data = "",
          const String &id = "");
Message *take();
} // namespace Engine
