# Disaster Response Dashboard (Frontend)

Frontend for the hospitality crisis-response command center.

## Environment

Create `.env` in this folder:

```env
REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_browser_key
```

## Run

```bash
npm install
npm start
```

App runs at `http://localhost:3000`.

### If You See ENOENT package.json

This frontend is in `disaster-response-dashboard/`.

If you run `npm install` from repo root, it fails because there is no root `package.json`.

Correct options:
```bash
cd disaster-response-dashboard
npm install
npm start
```

Or from root:
```bash
npm install --prefix disaster-response-dashboard
npm start --prefix disaster-response-dashboard
```

## Quick Test

1. Open dashboard and ensure map loads.
2. Confirm header shows `BRIDGE: LIVE` or `BRIDGE: MOCK`.
3. Submit a report from `REPORT INCIDENT` with location.
4. Verify incident appears in feed with hospitality metadata.
5. Open incident, update lifecycle status, and verify timeline updates.
6. Dispatch a unit and confirm auto `On Scene` update when vehicle arrives.

## Validate Build

```bash
npm test
npm run build
```

## Notes

- Full project setup and backend verification steps are documented in [../README.md](../README.md).
