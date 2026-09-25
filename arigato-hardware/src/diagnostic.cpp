#include <Arduino.h>

const int SOIL_PIN = 34;
const int RAIN_PIN = 35;
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

void setup() {
    Serial.begin(115200);
    analogReadResolution(12);

    pinMode(SOIL_PIN, INPUT);
    pinMode(RAIN_PIN, INPUT);
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);

    digitalWrite(TRIG_PIN, LOW);
}

void loop() {
    int soilRaw = analogRead(SOIL_PIN);
    int rainRaw = analogRead(RAIN_PIN);

    // Trigger JSN-SR04T ultrasonic pulse manually
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    unsigned long duration = pulseIn(ECHO_PIN, HIGH, 35000UL);

    Serial.println("===== RAW SENSOR TEST =====");
    Serial.printf("Soil GPIO34: %d\n", soilRaw);
    Serial.printf("Rain GPIO35: %d\n", rainRaw);

    if (duration == 0) {
        Serial.println("JSN distance: NO ECHO");
    } else {
        float distanceCm = (duration * 0.0343f) / 2.0f;
        Serial.printf("JSN distance: %.1f cm\n", distanceCm);
    }
    Serial.println("===========================");

    delay(2000);
}
