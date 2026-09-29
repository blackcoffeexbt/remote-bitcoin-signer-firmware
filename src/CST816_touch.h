#pragma once
#include <Arduino.h>
#include <Wire.h>
#include "pincfg.h"
#include "cst816_packet.h"

// Minimal CST816 driver for LilyGO's 1.91-inch QSPI Touch board. Register map
// and orientation reference: LilyGo-AMOLED-Series / SensorLib (see board guide).
class CST816Touch {
    bool online = false;
    CST816Contact contact;

    bool readRegisters(uint8_t reg, uint8_t *data, size_t length) {
        Wire.beginTransmission(Touch_ADDR);
        Wire.write(reg);
        if (Wire.endTransmission() != 0) return false;
        if (Wire.requestFrom(uint8_t(Touch_ADDR), length) != length) {
            while (Wire.available()) Wire.read();
            return false;
        }
        for (size_t i = 0; i < length; ++i) data[i] = Wire.read();
        return true;
    }

  public:
    bool begin() {
        pinMode(Touch_INT, INPUT);
        if (!Wire.begin(Touch_SDA, Touch_SCL)) return false;
        Wire.setTimeOut(20);
        uint8_t chip = 0;
        // An idle controller can sleep; retry during initial power-up.
        for (unsigned i = 0; i < 5; ++i) {
            if (readRegisters(0xa7, &chip, 1) &&
                (chip == 0xb4 || chip == 0xb5 || chip == 0xb6 || chip == 0xb7)) {
                online = true;
                break;
            }
            delay(20);
        }
        if (!online) return false;
        Serial.printf("CST816 touch chip: 0x%02X\n", chip);
        // Poll contact state even while the screen is dark, so a held wake
        // gesture remains consumed until the finger lifts.
        Wire.beginTransmission(Touch_ADDR);
        Wire.write(0xfe);
        Wire.write(0x01);
        online = Wire.endTransmission() == 0;
        return online;
    }

    bool touched() {
        uint8_t packet[13] = {};
        if (!online) return false;
        if (!readRegisters(0, packet, sizeof(packet)))
            return contact.update(nullptr, 0, millis());
        return contact.update(packet, sizeof(packet), millis());
    }

    void readData(uint16_t *x, uint16_t *y) {
        *x = contact.x();
        *y = contact.y();
    }
};
