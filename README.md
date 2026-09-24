# 🌱 ARIGATO — Smart Irrigation Intelligence

**ARIGATO** is a low-cost IoT-based smart irrigation prototype built for **NIRMAAN 2026**.

The system combines live field sensing, reservoir monitoring, crop-water modelling, weather intelligence and an explainable decision engine to help determine:

> **Should the farmer irrigate right now, and how much water should be applied?**

---

## Current Prototype

The working prototype currently includes:

- ESP32 field node
- Soil/moisture response sensing
- Ultrasonic reservoir monitoring
- Crop-specific irrigation model
- Weather integration with fallback mode
- Irrigation decision engine
- Local ESP32 REST API
- React + Vite live dashboard
- System health monitoring
- Explainable decision breakdown
- Water Intelligence calculations

The dashboard receives live data directly from the ESP32.

---

## Project Structure

```text
Arigato/
│
├── arigato-hardware/
│   ├── include/
│   │   ├── secrets.h              # Local Wi-Fi credentials - NOT committed
│   │   └── secrets.example.h      # Credential template
│   ├── src/
│   │   └── main.cpp
│   └── platformio.ini
│
├── arigato-dashboard/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   └── index.css
│   ├── package.json
│   └── vite.config.js
│
├── .gitignore
└── README.md
```

---

# 1. Clone the Repository

```bash
git clone <YOUR-GITHUB-REPOSITORY-URL>
cd Arigato
```

---

# 2. Configure ESP32 Wi-Fi

The real Wi-Fi credentials are intentionally excluded from Git.

Inside:

```text
arigato-hardware/include/
```

copy:

```text
secrets.example.h
```

and create:

```text
secrets.h
```

Then edit `secrets.h`:

```cpp
#pragma once

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
```

Do **not** commit `secrets.h`.

---

# 3. Build and Upload ESP32 Firmware

Open the project in VS Code with PlatformIO installed.

Move into the hardware directory:

```powershell
cd arigato-hardware
```

Build:

```powershell
pio run
```

Upload to the ESP32:

```powershell
pio run --target upload
```

If `pio` is not recognized on Windows, use:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run
```

Upload:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run --target upload
```

---

# 4. Open ESP32 Serial Monitor

First determine the ESP32 COM port.

In VS Code / PlatformIO, check:

```text
Ports
```

Then run, replacing `COM7` if necessary:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" device monitor --port COM7 --baud 115200
```

Expected startup output includes:

```text
WiFi Status : CONNECTED
IP Address  : <ESP32-IP>

ARIGATO API SERVER STARTED
Dashboard API : http://<ESP32-IP>/api/status
```

Press:

```text
Ctrl + C
```

to stop the serial monitor.

> The serial monitor must normally be stopped before uploading new firmware because the COM port may otherwise be occupied.

---

# 5. Test the ESP32 API

Once the ESP32 is connected to Wi-Fi, open:

```text
http://<ESP32-IP>/api/status
```

For example, during development our ESP32 may receive a local IP such as:

```text
http://10.x.x.x/api/status
```

The exact IP can change whenever the ESP32 reconnects to the network.

You should receive JSON containing sections similar to:

```json
{
  "system": {},
  "field": {},
  "soil": {},
  "reservoir": {},
  "weather": {},
  "model": {},
  "decision": {}
}
```

You can also test it from PowerShell:

```powershell
Invoke-RestMethod -Uri "http://<ESP32-IP>/api/status" -TimeoutSec 5
```

---

# 6. Configure Dashboard API Address

Check the ESP32's current IP address in the serial monitor.

Then ensure the React dashboard API URL in `App.jsx` points to:

```javascript
http://<ESP32-IP>/api/status
```

The **computer running the dashboard and the ESP32 must be able to reach each other over the local network.**

---

# 7. Install Dashboard Dependencies

Open a second terminal:

```powershell
cd arigato-dashboard
```

Install packages:

```powershell
npm install
```

---

# 8. Run the React Dashboard

From:

```text
arigato-dashboard/
```

run:

```powershell
npm run dev
```

Vite will display a local URL, normally:

```text
http://localhost:5173/
```

or:

```text
http://127.0.0.1:5173/
```

Open it in the browser.

---

# Quick Start

## Terminal 1 — ESP32

```powershell
cd arigato-hardware
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" device monitor --port COM7 --baud 115200
```

Find the ESP32 IP address.

Test:

```text
http://<ESP32-IP>/api/status
```

## Terminal 2 — Dashboard

```powershell
cd arigato-dashboard
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:5173/
```

---

# Live Data Flow

```text
Field Sensors
      │
      ▼
    ESP32
      │
      ├── Sensor Processing
      ├── Crop Model
      ├── Reservoir Analysis
      ├── Weather Intelligence
      └── Decision Engine
      │
      ▼
 /api/status
      │
      ▼
React + Vite Dashboard
      │
      ├── Live Field Status
      ├── Irrigation Recommendation
      ├── Decision Breakdown
      ├── System Health
      └── Water Intelligence
```

---

# Troubleshooting

### Dashboard says ESP32 is offline

First open:

```text
http://<ESP32-IP>/api/status
```

If this does not load, check:

- ESP32 is powered
- ESP32 Wi-Fi connection
- current ESP32 IP address
- laptop and ESP32 network connectivity

---

### API works in browser but dashboard does not

Test from PowerShell:

```powershell
Invoke-RestMethod -Uri "http://<ESP32-IP>/api/status" -TimeoutSec 5
```

Then verify that the API address configured in the React application matches the ESP32's current IP.

---

### Serial monitor cannot open COM port

Check the current COM port because Windows may assign a different port after reconnecting the ESP32.

Also close any other serial monitor currently using the port.

---

### Strange characters appear in serial monitor

Ensure the monitor baud rate is:

```text
115200
```

---

### Weather shows FALLBACK

The irrigation engine contains fallback weather behaviour when live weather information is unavailable.

This allows the prototype to continue demonstrating its decision pipeline while clearly identifying the weather source as fallback data.

---

# Important Security Note

Never commit:

```text
secrets.h
```

or any real:

- Wi-Fi password
- API key
- authentication token
- private credential

Only `secrets.example.h` should be committed as the configuration template.

---

## Team

**Arigato Algorithms**

Built for **NIRMAAN 2026**.

### Goal

Build a practical irrigation intelligence system using minimal hardware and a stronger software decision layer — making every litre of irrigation explainable.