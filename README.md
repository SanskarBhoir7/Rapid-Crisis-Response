# Disaster Response Dashboard v2.0 🚨🚁

**A Next-Gen, AI-Powered Command Center for Urban Emergency Management.**
<img width="1914" height="1078" alt="Screenshot 2026-02-10 at 9 36 43 PM" src="https://github.com/user-attachments/assets/1716ad98-cf97-494d-8604-968b7a0802f9" />



## 📖 Overview

The **Disaster Response Dashboard** is a realtime visualization and command tool designed to aid emergency responders in managing urban crises. Built for the city of Mumbai, it integrates live location tracking, AI-driven situation analysis, and smart resource allocation into a unified "Glassmorphism" interface.

This project demonstrates the application of **Generative AI** and **Geospatial Engineering** to solve critical real-world problems.

## ✨ Key Features

### 🧠 AI-Driven Intelligence
-   **Realtime Situation Reports**: Uses **Google Gemini 1.5 Flash** to analyze weather, traffic, and social sentiment, generating concise executive summaries for commanders.
-   **Authenticity Scoring**: AI evaluates incoming SOS messages to filter out spam and prioritize genuine emergencies.
-   **Severity Classification**: Automatically categorizes incidents (Fire, Medical, Accident) and assigns color-coded urgency levels.

### 🗺️ Advanced Geospatial Operations
-   **Live Fleet Tracking**: Realtime movement of Ambulances, Police, and Fire units on a **Google Map**.
-   **Smart Routing**: Vehicles follow actual road networks using the **Google Directions API** (not straight lines).
-   **Traffic Overlay**: Toggleable real-time traffic data layer to aid routing decisions.

### ⚡ Interactive Command Interface
-   **Cinematic UX**: Features a "System Initialization" boot sequence (Matrix-style) and a high-fidelity dark mode UI.
-   **Incident Command Panel**: Click on any incident to view details and dispatch the nearest available unit with one distinct action.
-   **Auto-Refresh Fleet**: Units automatically return to 'IDLE' status after completing missions, simulating a living ecosystem.

### 🏨 Hospitality Incident Workflow (New)
-   **Structured Hospitality Reports**: Capture venue, floor, room/zone, reporter type, and affected people count.
-   **Lifecycle Tracking**: Persistent status transitions (`Created` -> `Acknowledged` -> `Dispatched` -> `En Route` -> `On Scene` -> `Resolved`) with timeline logs.
-   **Live Sync**: Dashboard auto-syncs incident data with backend polling for near real-time collaboration.
-   **Emergency Bridge Hook**: Optional outbound webhook notifications for critical incidents and major lifecycle changes.

## 🛠️ Tech Stack

-   **Frontend**: React.js, Framer Motion (Animations), Lucide React (Icons), Google Maps JavaScript API (@vis.gl/react-google-maps).
-   **Backend**: Python Flask, NumPy (Data Simulation).
-   **AI & APIs**: Google Gemini API, Google Maps Platform (Directions, Geocoding, Places).
-   **Styling**: CSS Modules, Glassmorphism Design System.

## 🚀 Installation & Setup

### Prerequisites
-   Node.js & npm
-   Python 3.8+
-   Google Maps API Key & Gemini API Key

### 1. Clone the Repository
```bash
git clone https://github.com/Vaibhav2005-r/Disaster.git
cd Disaster
```

### 2. Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```
*Create a `.env` file in `backend/`:*
```env
GEMINI_API_KEY=your_key_here
GOOGLE_MAPS_API_KEY=your_key_here
GEMINI_MODEL=gemini-1.5-flash
EMERGENCY_WEBHOOK_URL=https://your-webhook-endpoint (optional)
```
*Run the server:*
```bash
python app.py
```

### 3. Frontend Setup
```bash
cd ../disaster-response-dashboard
npm install
```
*Create a `.env` file in `disaster-response-dashboard/`:*
```env
REACT_APP_GOOGLE_MAPS_API_KEY=your_key_here
```
*Start the dashboard:*
```bash
npm start
```

### Common Frontend Install Error (ENOENT package.json)

If you run `npm install` in repository root (`Rapid-Crisis-Response`), you may get:
- `ENOENT: no such file or directory, open ...Rapid-Crisis-Response/package.json`

Reason:
- `package.json` is inside `disaster-response-dashboard/`, not repo root.

Use either:
```bash
cd disaster-response-dashboard
npm install
npm start
```

Or run from root without changing directory:
```bash
npm install --prefix disaster-response-dashboard
npm start --prefix disaster-response-dashboard
```

## ✅ How To Test End-To-End

Use this sequence to verify the current implementation after setup.

### 1. Start Both Services

In Terminal 1 (backend):
```bash
cd backend
python app.py
```

In Terminal 2 (frontend):
```bash
cd disaster-response-dashboard
npm start
```

Expected:
- Backend runs on `http://127.0.0.1:5001`
- Frontend runs on `http://localhost:3000`

### 2. Check Backend Health Endpoints

Open these URLs in browser (or Postman):
- `http://127.0.0.1:5001/get_sos_data`
- `http://127.0.0.1:5001/get_situation_update`
- `http://127.0.0.1:5001/bridge_status`

Expected:
- `/get_sos_data` returns a JSON array
- `/get_situation_update` returns temperature/condition/insight JSON
- `/bridge_status` returns mode (`live` or `mock`)

### 3. Test Incident Reporting Flow

In the dashboard:
1. Click `REPORT INCIDENT`
2. Fill description + venue/floor/room/reporter/affected people
3. Click `Use My Current Location`
4. Submit

Expected:
- New incident appears in live feed
- Incident opens in detail panel
- Incident includes hospitality fields
- Incident status starts at `Created`

### 4. Test Lifecycle Transitions

From Incident Command panel, click lifecycle actions in order:
- `Acknowledged` -> `Dispatched` -> `En Route` -> `On Scene` -> `Resolved`

Expected:
- Timeline records each transition
- Invalid jumps are blocked by backend (for example `Created` -> `Resolved`)

### 5. Test Dispatch + Auto On Scene

1. Assign a vehicle to an incident
2. Wait for unit marker to reach destination

Expected:
- Incident is set to `Dispatched` on assignment
- Incident auto-updates to `On Scene` when vehicle arrives

### 6. Test KPI Strip

After running a few incidents/transitions, confirm KPI cards update:
- Avg Ack
- Avg Dispatch
- Avg Resolve
- Critical Open

### 7. Test Emergency Bridge Mode

Check header badge:
- `BRIDGE: MOCK` when `EMERGENCY_WEBHOOK_URL` is empty
- `BRIDGE: LIVE` when `EMERGENCY_WEBHOOK_URL` is configured and reachable

You can also verify via:
- `http://127.0.0.1:5001/bridge_status`

### 8. Quick Regression Checks

Run frontend tests/build:
```bash
cd disaster-response-dashboard
npm test
npm run build
```

Optional backend syntax check:
```bash
cd backend
python -m py_compile app.py ai_core.py preprocess_data.py
```

## Troubleshooting

### Gemini model 404 (`model ... not found`)

If backend logs show model-not-found errors for Gemini:
1. Ensure `GEMINI_API_KEY` is valid.
2. Set `GEMINI_MODEL=gemini-1.5-flash` in `backend/.env`.
3. Restart backend after changing `.env`.
4. If it still fails, list models available to your key and set `GEMINI_MODEL` accordingly:

```bash
python -c "import os, google.generativeai as genai; from dotenv import load_dotenv; load_dotenv(); genai.configure(api_key=os.getenv('GEMINI_API_KEY')); print('\n'.join([m.name for m in genai.list_models() if 'generateContent' in (m.supported_generation_methods or [])]))"
```

### `pip` dependency conflict warning (for TensorFlow/protobuf)

If you see warnings like `tensorflow-intel requires protobuf<5` while installing backend deps:
- This usually means global Python packages are mixing.
- Recommended: run backend in a dedicated virtual environment.

Windows example:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### Repeated `/get_sos_data` requests in logs

In development, repeated/duplicate requests can happen due to:
- React dev behavior (Strict Mode),
- multiple open browser tabs,
- hot reload/restart cycles.

This is expected in local dev as long as responses are `200` and app behavior is normal.

---

**Developed by Vaibhav** | *Engineering a Safer Tomorrow*
