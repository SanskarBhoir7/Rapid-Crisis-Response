# Disaster Response Dashboard (Frontend)

React frontend for the Mumbai disaster-response command center.

## Prerequisites

- Node.js 18+ and npm
- A Google Maps browser API key
- The backend running on `http://127.0.0.1:5001`

## Environment

Create `disaster-response-dashboard/.env`:

```env
REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_browser_key
```

## How To Start

### Start from the frontend folder

```bash
cd disaster-response-dashboard
npm install
npm start
```

The dashboard starts at `http://localhost:3000`.

### Start from the repo root

```bash
npm install --prefix disaster-response-dashboard
npm start --prefix disaster-response-dashboard
```

## Full Project Start Order

The frontend depends on the Flask backend. Start the project in this order.

### Terminal 1: backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Backend runs at `http://127.0.0.1:5001`.

### Terminal 2: frontend

```bash
cd disaster-response-dashboard
npm install
npm start
```

Frontend runs at `http://localhost:3000`.

## Quick Checks

1. Open `http://localhost:3000`.
2. Confirm the header shows `BRIDGE: LIVE` or `BRIDGE: MOCK`.
3. Confirm incidents load in the feed.
4. Submit a report from `REPORT INCIDENT`.
5. Verify the incident appears in the feed and detail panel.
6. Dispatch a unit and confirm the incident later updates to `On Scene`.

## Validation

```bash
cmd /c npm test -- --watchAll=false --runInBand
cmd /c npm run build
```

## Common Issue: `ENOENT package.json`

`package.json` is inside `disaster-response-dashboard/`, not the repo root.

Use either:

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

## Notes

- Full backend setup and end-to-end verification are documented in [../README.md](../README.md).
