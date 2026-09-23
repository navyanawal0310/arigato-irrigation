#include <Arduino.h>

// ============================================================
// ARIGATO ALGORITHMS
// QUANTITATIVE IRRIGATION DECISION ENGINE - V2
// ============================================================
//
// Inputs:
//   1. HW-390 moisture response sensor
//   2. JSN-SR04T reservoir level sensor
//
// Outputs:
//   - Moisture Response Index (0-100)
//   - Dryness Score (0-100)
//   - Tank Level (0-100%)
//   - Estimated Water Volume
//   - Irrigation Need Score (0-100)
//   - Confidence Score (0-100)
//   - Explainable irrigation recommendation
//
// IMPORTANT:
// Soil calibration values are PROTOTYPE values.
// Replace DRY_ADC and WET_ADC after real soil calibration.
//
// ============================================================


// ------------------------------------------------------------
// PIN CONFIGURATION
// ------------------------------------------------------------

const int SOIL_PIN = 34;

const int TRIG_PIN = 5;
const int ECHO_PIN = 18;


// ------------------------------------------------------------
// PROTOTYPE SOIL CALIBRATION
// ------------------------------------------------------------
//
// ESP32 ADC range is approximately 0-4095.
//
// These are provisional demonstration endpoints.
// They are NOT being claimed as calibrated soil moisture values.
//

const int DRY_ADC = 3500;
const int WET_ADC = 1200;


// ------------------------------------------------------------
// RESERVOIR CALIBRATION
// ------------------------------------------------------------

const float EMPTY_DISTANCE = 22.7;
const float FULL_DISTANCE  = 20.9;

const float TANK_CAPACITY_ML = 150.0;


// ------------------------------------------------------------
// THRESHOLDS
// ------------------------------------------------------------

const float CRITICAL_TANK = 15.0;
const float LOW_TANK      = 30.0;


// ============================================================
// UTILITY
// ============================================================

float clampFloat(float value, float minimum, float maximum)
{
    if (value < minimum)
        return minimum;

    if (value > maximum)
        return maximum;

    return value;
}


// ============================================================
// HW-390 FILTERED ADC
// ============================================================

int readFilteredSoilADC()
{
    const int SAMPLE_COUNT = 20;

    long total = 0;

    for (int i = 0; i < SAMPLE_COUNT; i++)
    {
        total += analogRead(SOIL_PIN);

        delay(10);
    }

    return total / SAMPLE_COUNT;
}


// ============================================================
// MOISTURE RESPONSE INDEX
// ============================================================
//
// MRI = 0   -> prototype dry endpoint
// MRI = 100 -> prototype wet endpoint
//
// This is NOT yet agronomic volumetric water content.
//

float calculateMoistureIndex(int adc)
{
    float moisture =
        ((float)(DRY_ADC - adc) /
        (float)(DRY_ADC - WET_ADC))
        * 100.0;

    return clampFloat(moisture, 0, 100);
}


// ============================================================
// DRYNESS SCORE
// ============================================================

float calculateDryness(float moistureIndex)
{
    return 100.0 - moistureIndex;
}


// ============================================================
// SINGLE JSN READING
// ============================================================

float readDistanceOnce()
{
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(5);

    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);

    digitalWrite(TRIG_PIN, LOW);

    unsigned long duration =
        pulseIn(ECHO_PIN, HIGH, 100000UL);

    if (duration == 0)
        return -1;

    return (duration * 0.0343f) / 2.0f;
}


// ============================================================
// FILTERED JSN READING
// ============================================================

float readFilteredDistance()
{
    const int SAMPLE_COUNT = 7;

    float total = 0;
    int validSamples = 0;

    for (int i = 0; i < SAMPLE_COUNT; i++)
    {
        float distance = readDistanceOnce();

        if (distance > 0)
        {
            total += distance;
            validSamples++;
        }

        delay(70);
    }

    if (validSamples == 0)
        return -1;

    return total / validSamples;
}


// ============================================================
// TANK LEVEL
// ============================================================

float calculateTankPercentage(float distance)
{
    float percentage =
        ((EMPTY_DISTANCE - distance) /
        (EMPTY_DISTANCE - FULL_DISTANCE))
        * 100.0;

    return clampFloat(percentage, 0, 100);
}


// ============================================================
// WATER VOLUME
// ============================================================

float calculateWaterVolume(float tankPercentage)
{
    return
        (tankPercentage / 100.0)
        * TANK_CAPACITY_ML;
}


// ============================================================
// IRRIGATION NEED SCORE
// ============================================================
//
// V2:
//
// INS is currently driven by dryness.
//
// This is intentionally kept separate from reservoir level.
//
// Tank level answers:
// "CAN we irrigate?"
//
// Dryness answers:
// "DO we need irrigation?"
//
// Future V3:
// INS will also include crop demand, weather and rain forecast.
//

float calculateIrrigationNeed(float dryness)
{
    // Non-linear response:
    //
    // Dryness < 30:
    // Little/no irrigation requirement
    //
    // Dryness 30-70:
    // Increasing requirement
    //
    // Dryness > 70:
    // Strong irrigation requirement

    float score;

    if (dryness < 30)
    {
        score = dryness * 0.5;
    }

    else if (dryness < 70)
    {
        score =
            15.0 +
            ((dryness - 30.0) * 1.5);
    }

    else
    {
        score =
            75.0 +
            ((dryness - 70.0) * 0.8333);
    }

    return clampFloat(score, 0, 100);
}


// ============================================================
// CONFIDENCE SCORE
// ============================================================

float calculateConfidence(
    bool soilOK,
    bool tankOK,
    int validTankCondition
)
{
    float confidence = 100.0;

    if (!soilOK)
        confidence -= 50;

    if (!tankOK)
        confidence -= 40;

    if (!validTankCondition)
        confidence -= 10;

    // Soil is prototype calibrated,
    // therefore cap confidence for V2.

    if (confidence > 85)
        confidence = 85;

    return clampFloat(confidence, 0, 100);
}


// ============================================================
// RESERVOIR CLASSIFICATION
// ============================================================

String getTankState(float tankPercentage)
{
    if (tankPercentage < CRITICAL_TANK)
        return "CRITICAL";

    if (tankPercentage < LOW_TANK)
        return "LOW";

    if (tankPercentage < 70)
        return "AVAILABLE";

    return "GOOD";
}


// ============================================================
// IRRIGATION CLASSIFICATION
// ============================================================

String getNeedState(float score)
{
    if (score < 25)
        return "LOW";

    if (score < 50)
        return "MODERATE";

    if (score < 75)
        return "HIGH";

    return "CRITICAL";
}


// ============================================================
// FINAL DECISION ENGINE
// ============================================================

String calculateDecision(
    float irrigationNeed,
    float tankPercentage,
    bool soilOK,
    bool tankOK
)
{
    // Sensor safety comes first

    if (!soilOK || !tankOK)
    {
        return "CHECK SENSORS";
    }


    // Reservoir safety gate

    if (tankPercentage < CRITICAL_TANK)
    {
        return "HOLD - WATER CRITICAL";
    }


    // Low irrigation requirement

    if (irrigationNeed < 25)
    {
        return "NO IRRIGATION";
    }


    // Moderate requirement

    if (irrigationNeed < 50)
    {
        return "MONITOR";
    }


    // Irrigation required but reservoir low

    if (tankPercentage < LOW_TANK)
    {
        return "DELAY - LOW WATER";
    }


    // High irrigation requirement

    if (irrigationNeed < 75)
    {
        return "IRRIGATE SOON";
    }


    // Critical irrigation requirement

    return "IRRIGATE NOW";
}


// ============================================================
// EXPLANATION ENGINE
// ============================================================

String generateReason(
    float irrigationNeed,
    float tankPercentage,
    bool soilOK,
    bool tankOK
)
{
    if (!soilOK)
        return "Moisture sensor reading invalid";

    if (!tankOK)
        return "Reservoir sensor unavailable";

    if (tankPercentage < CRITICAL_TANK)
        return "Insufficient reservoir water";

    if (irrigationNeed < 25)
        return "Moisture response indicates low water demand";

    if (irrigationNeed < 50)
        return "Moderate dryness; continue monitoring";

    if (tankPercentage < LOW_TANK)
        return "Irrigation demand exists but reservoir is low";

    if (irrigationNeed < 75)
        return "High dryness with sufficient reservoir water";

    return "Severe dryness with sufficient reservoir water";
}


// ============================================================
// SETUP
// ============================================================

void setup()
{
    Serial.begin(115200);

    pinMode(SOIL_PIN, INPUT);

    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);

    digitalWrite(TRIG_PIN, LOW);

    delay(1500);

    Serial.println();
    Serial.println("==========================================");
    Serial.println("       ARIGATO DECISION ENGINE V2");
    Serial.println("==========================================");
    Serial.println("Quantitative Irrigation Intelligence");
    Serial.println("Prototype Calibration Mode");
    Serial.println("==========================================");
}


// ============================================================
// MAIN LOOP
// ============================================================

void loop()
{
    // --------------------------------------------------------
    // READ SENSORS
    // --------------------------------------------------------

    int soilADC =
        readFilteredSoilADC();

    float distance =
        readFilteredDistance();


    // --------------------------------------------------------
    // SENSOR HEALTH
    // --------------------------------------------------------

    bool soilOK =
        soilADC >= 0 &&
        soilADC <= 4095;

    bool tankOK =
        distance > 0;


    // --------------------------------------------------------
    // SOIL CALCULATIONS
    // --------------------------------------------------------

    float moistureIndex =
        calculateMoistureIndex(soilADC);

    float dryness =
        calculateDryness(moistureIndex);


    // --------------------------------------------------------
    // TANK CALCULATIONS
    // --------------------------------------------------------

    float tankPercentage = 0;

    float waterVolume = 0;


    if (tankOK)
    {
        tankPercentage =
            calculateTankPercentage(distance);

        waterVolume =
            calculateWaterVolume(tankPercentage);
    }


    // --------------------------------------------------------
    // IRRIGATION ENGINE
    // --------------------------------------------------------

    float irrigationNeed =
        calculateIrrigationNeed(dryness);


    String needState =
        getNeedState(irrigationNeed);


    String tankState =
        tankOK
        ? getTankState(tankPercentage)
        : "ERROR";


    int tankCalibrationValid =
        tankOK ? 1 : 0;


    float confidence =
        calculateConfidence(
            soilOK,
            tankOK,
            tankCalibrationValid
        );


    String decision =
        calculateDecision(
            irrigationNeed,
            tankPercentage,
            soilOK,
            tankOK
        );


    String reason =
        generateReason(
            irrigationNeed,
            tankPercentage,
            soilOK,
            tankOK
        );


    // ========================================================
    // OUTPUT
    // ========================================================

    Serial.println();
    Serial.println(
        "=============== FIELD DATA ==============="
    );


    Serial.println();
    Serial.println(
        "SOIL / MOISTURE RESPONSE"
    );

    Serial.print(
        "Raw ADC             : "
    );

    Serial.println(soilADC);


    Serial.print(
        "Moisture Index      : "
    );

    Serial.print(moistureIndex, 1);

    Serial.println(" / 100");


    Serial.print(
        "Dryness Score       : "
    );

    Serial.print(dryness, 1);

    Serial.println(" / 100");


    Serial.println();
    Serial.println(
        "RESERVOIR"
    );


    if (tankOK)
    {
        Serial.print(
            "Distance            : "
        );

        Serial.print(distance, 2);

        Serial.println(" cm");


        Serial.print(
            "Tank Level          : "
        );

        Serial.print(tankPercentage, 1);

        Serial.println(" %");


        Serial.print(
            "Estimated Water     : "
        );

        Serial.print(waterVolume, 0);

        Serial.println(" mL");


        Serial.print(
            "Reservoir State     : "
        );

        Serial.println(tankState);
    }

    else
    {
        Serial.println(
            "JSN Sensor          : ERROR"
        );
    }


    Serial.println();
    Serial.println(
        "============= INTELLIGENCE ==============="
    );


    Serial.print(
        "Irrigation Need     : "
    );

    Serial.print(irrigationNeed, 1);

    Serial.println(" / 100");


    Serial.print(
        "Need Classification : "
    );

    Serial.println(needState);


    Serial.print(
        "Confidence          : "
    );

    Serial.print(confidence, 0);

    Serial.println(" %");


    Serial.println();
    Serial.println(
        "=============== DECISION ================="
    );


    Serial.print(
        "ACTION              : "
    );

    Serial.println(decision);


    Serial.print(
        "WHY                 : "
    );

    Serial.println(reason);


    Serial.println(
        "=========================================="
    );


    delay(2500);
}