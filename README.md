# Disaster Response Dashboard v2.0

AI-assisted emergency response dashboard for Mumbai, with a React frontend and Flask backend.

<img width="1914" height="1078" alt="Dashboard screenshot" src="https://github.com/user-attachments/assets/1716ad98-cf97-494d-8604-968b7a0802f9" />

## Overview

This project combines incident intake, live fleet tracking, map-based dispatch, and AI-assisted situational updates in a single command-center interface.

## Key Features

- AI-generated situation summaries and severity classification
- Live incident feed with hospitality metadata
- Vehicle dispatch and route visualization on Google Maps
- Incident lifecycle tracking from `Created` to `Resolved`
- Optional emergency bridge webhook support

## Tech Stack

- Frontend: React, Framer Motion, Lucide React, `@vis.gl/react-google-maps`
- Backend: Flask, NumPy, Python dotenv
- APIs: Google Maps Platform and Gemini

## How To Start

### Prerequisites

- Node.js 18+ and npm
- Python 3.8+
- Google Maps API key
- Gemini API key

### 1. Configure the backend

Create `backend/.env`:

```env
GEMINI_API_KEY=your_key_here
GOOGLE_MAPS_API_KEY=your_key_here
GEMINI_MODEL=gemini-1.5-flash
EMERGENCY_WEBHOOK_URL=
```

### 2. Start the backend

Open Terminal 1:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Expected backend URL: `http://127.0.0.1:5001`

### 3. Configure the frontend

Create `disaster-response-dashboard/.env`:

```env
REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_browser_key
```

### 4. Start the frontend

Open Terminal 2:

```bash
cd disaster-response-dashboard
npm install
npm start
```

Expected frontend URL: `http://localhost:3000`

### 5. Start frontend from repo root instead

```bash
npm install --prefix disaster-response-dashboard
npm start --prefix disaster-response-dashboard
```

## End-To-End Check

Use this sequence to verify the current implementation after setup.

### 1. Start both services

In Terminal 1:

```bash
cd backend
python app.py
```

In Terminal 2:

```bash
cd disaster-response-dashboard
npm start
```

Expected:

- Backend runs on `http://127.0.0.1:5001`
- Frontend runs on `http://localhost:3000`

### 2. Check backend endpoints

Open these URLs in a browser or API client:

- `http://127.0.0.1:5001/get_sos_data`
- `http://127.0.0.1:5001/get_situation_update`
- `http://127.0.0.1:5001/bridge_status`

Expected:

- `/get_sos_data` returns a JSON array
- `/get_situation_update` returns temperature, condition, and insight
- `/bridge_status` returns mode information

### 3. Test incident reporting

In the dashboard:

1. Click `REPORT INCIDENT`.
2. Fill in description and hospitality fields.
3. Use current location or provide a location.
4. Submit the form.

Expected:

- A new incident appears in the feed
- The incident opens in the detail panel
- The status starts at `Created`

### 4. Test lifecycle transitions

From the Incident Command panel, move through:

- `Acknowledged`
- `Dispatched`
- `En Route`
- `On Scene`
- `Resolved`

Expected:

- Timeline entries are recorded
- Invalid jumps are rejected by the backend

### 5. Test dispatch and arrival

1. Assign a vehicle to an incident.
2. Wait for the vehicle marker to reach the destination.

Expected:

- The incident becomes `Dispatched`
- The incident later updates to `On Scene`

### 6. Test KPI cards

After working through a few incidents, confirm these update:

- Avg Ack
- Avg Dispatch
- Avg Resolve
- Critical Open

### 7. Test bridge mode

Check the header badge:

- `BRIDGE: MOCK` when `EMERGENCY_WEBHOOK_URL` is empty
- `BRIDGE: LIVE` when the webhook is configured

You can also verify:

- `http://127.0.0.1:5001/bridge_status`

### 8. Quick regression checks

Frontend:

```bash
cd disaster-response-dashboard
cmd /c npm test -- --watchAll=false --runInBand
cmd /c npm run build
```

Optional backend syntax check:

```bash
cd backend
python -m py_compile app.py ai_core.py preprocess_data.py
```

## Troubleshooting

### `ENOENT package.json`

If you run `npm install` from the repo root, it fails because the frontend `package.json` is inside `disaster-response-dashboard/`.

Use:

```bash
cd disaster-response-dashboard
npm install
npm start
```

Or:

```bash
npm install --prefix disaster-response-dashboard
npm start --prefix disaster-response-dashboard
```

### Gemini model errors

If the backend logs show Gemini model-not-found errors:

1. Verify `GEMINI_API_KEY`.
2. Set `GEMINI_MODEL=gemini-1.5-flash` in `backend/.env`.
3. Restart the backend.

### `pip` dependency conflicts

If Python dependency warnings appear, use a dedicated virtual environment:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### Repeated `/get_sos_data` requests

Repeated requests in development can happen because of React development behavior, hot reload, or multiple open tabs. This is normal if responses stay successful and the UI works correctly.
