import json
import logging
import os
import queue
import time
import requests
from datetime import datetime, timedelta
from pathlib import Path
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

# --- Structured Logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("crisis-api")

app = Flask(__name__)
CORS(app)

# --- Configuration ---
PROCESSED_DATA_FILE = str(BASE_DIR / "processed_data.json")
BRIDGE_EVENTS_FILE = str(BASE_DIR / "bridge_events.json")
INCIDENT_NOTES_FILE = str(BASE_DIR / "incident_notes.json")
RESCUE_HQ_COORDS = "18.9486,72.8336"
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
EMERGENCY_WEBHOOK_URL = os.getenv("EMERGENCY_WEBHOOK_URL")

if not GOOGLE_MAPS_API_KEY:
    log.warning("GOOGLE_MAPS_API_KEY is not set. Route and nearby-place endpoints will return 503.")

# --- SSE Client Registry ---
_sse_clients: list[queue.Queue] = []


def _safe_int(value, default):
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _priority_from_severity(severity_score):
    if severity_score >= 8:
        return "Critical"
    if severity_score >= 6:
        return "High"
    return "Moderate"


def _normalize_incident(incident):
    """Backfill required fields so mixed legacy/new data remains UI-compatible."""
    severity_score = _safe_int(incident.get("severity_score", 5), 5)
    priority = incident.get("priority") or _priority_from_severity(severity_score)
    timestamp = incident.get("timestamp") or datetime.now().isoformat()
    status = incident.get("status") or "Created"
    status_timeline = incident.get("status_timeline") or [
        {
            "status": "Created",
            "timestamp": timestamp,
            "actor": "system",
            "note": "Incident registered"
        }
    ]

    incident["severity_score"] = severity_score
    incident["priority"] = priority
    incident["status"] = status
    incident["timestamp"] = timestamp
    incident["status_timeline"] = status_timeline if isinstance(status_timeline, list) else []
    incident["venue_name"] = incident.get("venue_name") or "Unknown Venue"
    incident["floor"] = incident.get("floor") or "Unknown"
    incident["room_or_zone"] = incident.get("room_or_zone") or "Unknown"
    incident["reporter_type"] = incident.get("reporter_type") or "Guest"
    incident["source"] = incident.get("source") or "manual_report"
    incident["channel"] = incident.get("channel") or "dashboard"
    incident["affected_people_count"] = max(1, _safe_int(incident.get("affected_people_count", 1), 1))

    return incident


def _classify_incident_from_description(description):
    desc_lower = description.lower()

    category = "General Emergency"
    urgency = "Urgent"
    severity = 6
    need_type = ["Police"]

    if "fire" in desc_lower or "explosion" in desc_lower or "smoke" in desc_lower:
        category = "Fire"
        urgency = "Life-threatening"
        severity = 9
        need_type = ["Fire", "Rescue"]
    elif "flood" in desc_lower or "drowning" in desc_lower or "water" in desc_lower:
        category = "Flooding"
        urgency = "Life-threatening"
        severity = 8
        need_type = ["Rescue", "Police"]
    elif "medical" in desc_lower or "blood" in desc_lower or "heart" in desc_lower or "injury" in desc_lower:
        category = "Medical Emergency"
        urgency = "Life-threatening"
        severity = 9
        need_type = ["Medical"]
    elif "collapse" in desc_lower or "trapped" in desc_lower:
        category = "Structure Collapse"
        urgency = "Life-threatening"
        severity = 10
        need_type = ["Fire", "Medical", "Police"]

    return {
        "category": category,
        "urgency": urgency,
        "severity": severity,
        "need_type": need_type,
    }


def _load_incidents():
    if not os.path.exists(PROCESSED_DATA_FILE):
        return []
    try:
        with open(PROCESSED_DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if not isinstance(data, list):
                raise ValueError("Processed incidents file must contain a JSON array.")
            return data
    except json.JSONDecodeError as e:
        raise ValueError(f"Processed incidents file is invalid JSON: {e}") from e


def _save_incidents(incidents):
    temp_file = f"{PROCESSED_DATA_FILE}.tmp"
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(incidents, f, indent=4)
    os.replace(temp_file, PROCESSED_DATA_FILE)


def _load_bridge_events():
    if not os.path.exists(BRIDGE_EVENTS_FILE):
        return []
    with open(BRIDGE_EVENTS_FILE, 'r', encoding='utf-8') as f:
        events = json.load(f)
        if isinstance(events, list):
            return events
        return []


def _google_maps_config_error():
    return jsonify({"error": "GOOGLE_MAPS_API_KEY is not configured on the backend."}), 503


def _save_bridge_events(events):
    temp_file = f"{BRIDGE_EVENTS_FILE}.tmp"
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(events, f, indent=4)
    os.replace(temp_file, BRIDGE_EVENTS_FILE)


def _record_bridge_event(event_type, incident, delivery):
    try:
        events = _load_bridge_events()
    except (json.JSONDecodeError, FileNotFoundError):
        events = []

    bridge_event = {
        "id": int(time.time() * 1000),
        "event_type": event_type,
        "timestamp": datetime.now().isoformat(),
        "delivery_status": "delivered" if delivery.get("delivered") else ("mocked" if delivery.get("mode") == "mock" else "failed"),
        "delivery_mode": delivery.get("mode", "unknown"),
        "status_code": delivery.get("status_code"),
        "reason": delivery.get("reason"),
        "error": delivery.get("error"),
        "incident": {
            "id": incident.get("id"),
            "status": incident.get("status"),
            "priority": incident.get("priority"),
            "category": incident.get("category"),
            "summary": incident.get("summary") or incident.get("original_message"),
            "venue_name": incident.get("venue_name"),
            "floor": incident.get("floor"),
            "room_or_zone": incident.get("room_or_zone"),
            "assigned_vehicle": incident.get("assigned_vehicle")
        }
    }

    events.insert(0, bridge_event)
    _save_bridge_events(events[:100])


def _send_emergency_bridge_event(event_type, incident):
    """
    Sends a structured event to an external webhook for emergency bridge integration.
    If EMERGENCY_WEBHOOK_URL is not configured, this becomes a no-op mock success.
    """
    payload = {
        "event_type": event_type,
        "timestamp": datetime.now().isoformat(),
        "incident": {
            "id": incident.get("id"),
            "status": incident.get("status"),
            "priority": incident.get("priority"),
            "category": incident.get("category"),
            "summary": incident.get("summary") or incident.get("original_message"),
            "urgency": incident.get("urgency"),
            "coordinates": incident.get("coordinates"),
            "venue_name": incident.get("venue_name"),
            "floor": incident.get("floor"),
            "room_or_zone": incident.get("room_or_zone"),
            "reporter_type": incident.get("reporter_type"),
            "affected_people_count": incident.get("affected_people_count"),
            "assigned_vehicle": incident.get("assigned_vehicle")
        }
    }

    if not EMERGENCY_WEBHOOK_URL:
        log.info("[Bridge] EMERGENCY_WEBHOOK_URL not configured. Mock sent: %s for incident %s", event_type, incident.get('id'))
        result = {"delivered": False, "mode": "mock", "reason": "webhook_not_configured"}
        _record_bridge_event(event_type, incident, result)
        return result

    try:
        response = requests.post(EMERGENCY_WEBHOOK_URL, json=payload, timeout=8)
        response.raise_for_status()
        result = {"delivered": True, "mode": "webhook", "status_code": response.status_code}
        _record_bridge_event(event_type, incident, result)
        return result
    except requests.exceptions.RequestException as e:
        log.error("[Bridge] Failed to send webhook event: %s", e)
        result = {"delivered": False, "mode": "webhook", "error": str(e)}
        _record_bridge_event(event_type, incident, result)
        return result

# --- SSE Helpers ---
def _broadcast_sse(event_type, data):
    """Push an event to all connected SSE clients."""
    message = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    dead = []
    for q in _sse_clients:
        try:
            q.put_nowait(message)
        except queue.Full:
            dead.append(q)
    for q in dead:
        try:
            _sse_clients.remove(q)
        except ValueError:
            pass


# --- API Endpoints ---
@app.route('/stream')
def stream():
    """Server-Sent Events endpoint for real-time incident updates."""
    def event_stream():
        q = queue.Queue(maxsize=50)
        _sse_clients.append(q)
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    message = q.get(timeout=30)
                    yield message
                except queue.Empty:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            try:
                _sse_clients.remove(q)
            except ValueError:
                pass

    return Response(event_stream(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@app.route('/get_sos_data', methods=['GET'])
def get_sos_data():
    log.info("Received request for SOS data")
    try:
        all_data = _load_incidents()
        normalized_data = [_normalize_incident(item) for item in all_data]
        filtered_data = [
            item for item in normalized_data
            if item.get("coordinates") and item.get("authenticity_score", 0) >= 4
        ]
        sorted_data = sorted(filtered_data, key=lambda x: x['severity_score'], reverse=True)
        log.info("Returning %d pre-processed and filtered messages.", len(sorted_data))
        return jsonify(sorted_data)
    except FileNotFoundError:
        return jsonify({"error": "Processed data file not found. Run the pre-processing script."}), 500
    except ValueError as e:
        return jsonify({"error": str(e)}), 500

@app.route('/get_situation_update', methods=['GET'])
def get_situation_update():
    from ai_core import generate_situation_report
    try:
        report = generate_situation_report()
        return jsonify(report)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/bridge_status', methods=['GET'])
def bridge_status():
    mode = "live" if EMERGENCY_WEBHOOK_URL else "mock"
    return jsonify({
        "mode": mode,
        "webhook_configured": bool(EMERGENCY_WEBHOOK_URL)
    })


@app.route('/bridge_events', methods=['GET'])
def bridge_events():
    try:
        limit = int(request.args.get('limit', 12))
    except ValueError:
        limit = 12

    limit = max(1, min(limit, 50))

    try:
        events = _load_bridge_events()
    except FileNotFoundError:
        events = []
    except json.JSONDecodeError:
        return jsonify({"error": "Failed to decode bridge events log."}), 500

    return jsonify(events[:limit])

@app.route('/get_route', methods=['GET'])
def get_route():
    if not GOOGLE_MAPS_API_KEY:
        return _google_maps_config_error()

    destination_lat = request.args.get('lat')
    destination_lng = request.args.get('lng')
    start_lat = request.args.get('start_lat')
    start_lng = request.args.get('start_lng')
    
    if not destination_lat or not destination_lng:
        return jsonify({"error": "Missing latitude or longitude parameters."}), 400
    
    origin = f"{start_lat},{start_lng}" if start_lat and start_lng else RESCUE_HQ_COORDS
    destination_coords = f"{destination_lat},{destination_lng}"
    
    url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {'origin': origin, 'destination': destination_coords, 'key': GOOGLE_MAPS_API_KEY}
    try:
        response = requests.get(url, params=params, timeout=8)
        response.raise_for_status()
        directions = response.json()
        if directions['status'] == 'OK':
            route = directions['routes'][0]
            leg = route['legs'][0]
            route_info = {
                "distance": leg['distance']['text'],
                "duration": leg['duration']['text'],
                "overview_polyline": route['overview_polyline']['points']
            }
            return jsonify(route_info)
        else:
            return jsonify({"error": "Directions API could not find a route.", "status": directions['status']}), 404
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Failed to call Directions API: {e}"}), 500

# ==============================================================================
# === NEW: API ENDPOINT FOR FINDING NEARBY PLACES OF INTEREST (POI) ===
# ==============================================================================
@app.route('/get_nearby_places', methods=['GET'])
def get_nearby_places():
    """
    Finds nearby hospitals, police stations, and fire stations for given coordinates.
    """
    lat = request.args.get('lat')
    lng = request.args.get('lng')
    if not GOOGLE_MAPS_API_KEY:
        return _google_maps_config_error()

    if not lat or not lng:
        return jsonify({"error": "Missing latitude or longitude parameters."}), 400

    location = f"{lat},{lng}"
    radius = 5000  # Search within a 5km radius

    # A helper function to perform the search for a specific place type
    def find_places(place_type):
        url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
        params = {
            'location': location,
            'radius': radius,
            'type': place_type,
            'key': GOOGLE_MAPS_API_KEY
        }
        try:
            response = requests.get(url, params=params, timeout=8)
            response.raise_for_status()
            results = response.json().get('results', [])
            # We only need the name and location for the map
            return [{"name": place['name'], "location": place['geometry']['location']} for place in results]
        except requests.exceptions.RequestException as e:
            print(f"Error finding {place_type}: {e}")
            return []

    # Perform searches for all three types
    hospitals = find_places('hospital')
    police_stations = find_places('police')
    fire_stations = find_places('fire_station')

    return jsonify({
        "hospitals": hospitals,
        "police_stations": police_stations,
        "fire_stations": fire_stations
    })

# ==============================================================================
# === NEW: REPORT INCIDENT ENDPOINT ===
# ==============================================================================
@app.route('/report_incident', methods=['POST'])
def report_incident():
    data = request.json
    log.info("Received new incident report: %s", data)
    
    # 1. Basic Validation
    if not data or 'description' not in data or 'lat' not in data or 'lng' not in data:
        return jsonify({"error": "Missing required fields (description, lat, lng)"}), 400

    description = str(data['description']).strip()
    venue_name = str(data.get('venue_name') or "Unknown Venue").strip()
    floor = str(data.get('floor') or "Unknown").strip()
    room_or_zone = str(data.get('room_or_zone') or "Unknown").strip()
    reporter_type = str(data.get('reporter_type') or "Guest").strip()
    if reporter_type not in ["Guest", "Staff", "Security"]:
        reporter_type = "Guest"

    try:
        affected_people_count = int(data.get('affected_people_count', 1))
    except (ValueError, TypeError):
        affected_people_count = 1
    if affected_people_count < 1:
        affected_people_count = 1

    try:
        lat = float(data['lat'])
        lng = float(data['lng'])
    except (ValueError, TypeError):
        return jsonify({"error": "Latitude and longitude must be valid numbers."}), 400

    classified = _classify_incident_from_description(description)
    generated_id = int(time.time() * 1000)
    timestamp = datetime.now().isoformat()
    priority = _priority_from_severity(classified["severity"])
    
    new_incident = {
        "id": generated_id,
        "original_message": description,
        "category": classified["category"],
        "priority": priority,
        "urgency": classified["urgency"],
        "need_type": classified["need_type"],
        "summary": description,
        "severity_score": classified["severity"],
        "coordinates": {
            "lat": lat,
            "lng": lng
        },
        "location": "User Reported Location",
        "location_text": "User Reported Location",
        "venue_name": venue_name,
        "floor": floor,
        "room_or_zone": room_or_zone,
        "reporter_type": reporter_type,
        "source": "manual_report",
        "channel": "dashboard_form",
        "affected_people_count": affected_people_count,
        "authenticity_score": 10, # User reported is generally high for demo
        "reasoning": "Direct verified report from user on ground.",
        "flags": [],
        "status": "Created",
        "status_timeline": [
            {
                "status": "Created",
                "timestamp": timestamp,
                "actor": "reporter",
                "note": "Incident submitted from report form"
            }
        ],
        "timestamp": timestamp
    }

    # 3. Add to our in-memory data (so it shows up in /get_sos_data calls)
    try:
        # Load existing
        current_data = _load_incidents()

        # Prepend new incident
        normalized_incident = _normalize_incident(new_incident)
        current_data.insert(0, normalized_incident)

        # Bridge trigger for high-priority incidents.
        if normalized_incident.get("severity_score", 0) >= 8:
            _send_emergency_bridge_event("incident_created_critical", normalized_incident)

        # Save back
        _save_incidents(current_data)

        # Broadcast to SSE clients
        _broadcast_sse("new_incident", normalized_incident)

        log.info("Incident saved successfully.")
        return jsonify({"message": "Incident reported successfully", "incident": normalized_incident})

    except Exception as e:
        log.error("Error saving incident: %s", e)
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/panic_alert', methods=['POST'])
def panic_alert():
    data = request.json or {}
    log.info("Received panic alert: %s", data)

    if 'lat' not in data or 'lng' not in data:
        return jsonify({"error": "Missing required fields (lat, lng)"}), 400

    try:
        lat = float(data['lat'])
        lng = float(data['lng'])
    except (ValueError, TypeError):
        return jsonify({"error": "Latitude and longitude must be valid numbers."}), 400

    venue_name = str(data.get('venue_name') or "Unknown Venue").strip()
    floor = str(data.get('floor') or "Unknown").strip()
    room_or_zone = str(data.get('room_or_zone') or "Unknown").strip()
    reporter_type = str(data.get('reporter_type') or "Staff").strip()
    if reporter_type not in ["Guest", "Staff", "Security"]:
        reporter_type = "Staff"

    generated_id = int(time.time() * 1000)
    timestamp = datetime.now().isoformat()
    panic_code = str(data.get('panic_code') or 'PANIC-01').strip()
    description = str(data.get('description') or "Silent panic button triggered. Immediate coordination required.").strip()
    try:
        affected_people_count = int(data.get('affected_people_count', 1))
    except (ValueError, TypeError):
        affected_people_count = 1
    if affected_people_count < 1:
        affected_people_count = 1

    new_incident = {
        "id": generated_id,
        "original_message": description,
        "category": "Panic Alert",
        "priority": "Critical",
        "urgency": "Life-threatening",
        "need_type": ["Police", "Medical"],
        "summary": f"Panic button activated at {venue_name}",
        "severity_score": 10,
        "coordinates": {
            "lat": lat,
            "lng": lng
        },
        "location": "Panic Button Trigger",
        "location_text": f"{venue_name} {floor} {room_or_zone}".strip(),
        "venue_name": venue_name,
        "floor": floor,
        "room_or_zone": room_or_zone,
        "reporter_type": reporter_type,
        "source": "panic_button",
        "channel": "silent_alarm",
        "panic_code": panic_code,
        "affected_people_count": affected_people_count,
        "authenticity_score": 10,
        "reasoning": "Direct panic trigger from hospitality staff channel.",
        "flags": [],
        "status": "Created",
        "status_timeline": [
            {
                "status": "Created",
                "timestamp": timestamp,
                "actor": "panic-button",
                "note": f"Panic alert triggered via {panic_code}"
            }
        ],
        "timestamp": timestamp
    }

    try:
        current_data = _load_incidents()
        normalized_incident = _normalize_incident(new_incident)
        current_data.insert(0, normalized_incident)
        _send_emergency_bridge_event("panic_alert_triggered", normalized_incident)
        _save_incidents(current_data)

        # Broadcast to SSE clients
        _broadcast_sse("new_incident", normalized_incident)

        log.info("Panic alert saved successfully.")
        return jsonify({"message": "Panic alert created", "incident": normalized_incident})
    except Exception as e:
        log.error("Error saving panic alert: %s", e)
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/update_incident_status', methods=['POST'])
def update_incident_status():
    data = request.json or {}

    incident_id = data.get('incident_id')
    status = str(data.get('status') or '').strip()
    actor = str(data.get('actor') or 'operator').strip()
    note = str(data.get('note') or '').strip()
    assigned_vehicle = data.get('assigned_vehicle')

    valid_statuses = ["Created", "Acknowledged", "Dispatched", "En Route", "On Scene", "Resolved"]
    allowed_transitions = {
        "Created": ["Acknowledged", "Dispatched"],
        "Acknowledged": ["Dispatched", "Resolved"],
        "Dispatched": ["En Route", "On Scene", "Resolved"],
        "En Route": ["On Scene", "Resolved"],
        "On Scene": ["Resolved"],
        "Resolved": []
    }

    if incident_id is None or not status:
        return jsonify({"error": "Missing required fields (incident_id, status)."}), 400

    if status not in valid_statuses:
        return jsonify({"error": f"Invalid status. Valid values: {', '.join(valid_statuses)}"}), 400

    try:
        incidents = _load_incidents()
    except Exception as e:
        return jsonify({"error": f"Failed to load incidents: {e}"}), 500

    incident_index = None
    for idx, item in enumerate(incidents):
        if str(item.get('id')) == str(incident_id):
            incident_index = idx
            break

    if incident_index is None:
        return jsonify({"error": "Incident not found."}), 404

    incident = _normalize_incident(incidents[incident_index])
    current_status = incident.get('status', 'Created')

    if status != current_status:
        next_allowed = allowed_transitions.get(current_status, [])
        if status not in next_allowed:
            return jsonify({
                "error": f"Invalid transition from {current_status} to {status}. Allowed: {', '.join(next_allowed) if next_allowed else 'none'}"
            }), 400

    incident['status'] = status
    if assigned_vehicle is not None:
        incident['assigned_vehicle'] = assigned_vehicle

    incident['status_timeline'].append({
        "status": status,
        "timestamp": datetime.now().isoformat(),
        "actor": actor,
        "note": note or f"Status updated to {status}"
    })

    if status in ["Dispatched", "On Scene", "Resolved"]:
        _send_emergency_bridge_event(f"incident_{status.lower().replace(' ', '_')}", incident)

    incidents[incident_index] = incident

    try:
        _save_incidents(incidents)
    except Exception as e:
        return jsonify({"error": f"Failed to save incident update: {e}"}), 500

    # Broadcast to SSE clients
    _broadcast_sse("status_update", incident)

    return jsonify({"message": "Incident status updated", "incident": incident})


# --- Incident Notes / Communication Log ---
def _load_notes():
    if not os.path.exists(INCIDENT_NOTES_FILE):
        return {}
    try:
        with open(INCIDENT_NOTES_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, FileNotFoundError):
        return {}


def _save_notes(notes):
    temp_file = f"{INCIDENT_NOTES_FILE}.tmp"
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(notes, f, indent=4)
    os.replace(temp_file, INCIDENT_NOTES_FILE)


@app.route('/incident_notes/<incident_id>', methods=['GET'])
def get_incident_notes(incident_id):
    notes = _load_notes()
    return jsonify(notes.get(str(incident_id), []))


@app.route('/incident_notes', methods=['POST'])
def add_incident_note():
    data = request.json or {}
    incident_id = str(data.get('incident_id', '')).strip()
    author = str(data.get('author', 'operator')).strip()
    message = str(data.get('message', '')).strip()

    if not incident_id or not message:
        return jsonify({"error": "Missing incident_id or message."}), 400

    note = {
        "id": int(time.time() * 1000),
        "author": author,
        "message": message,
        "timestamp": datetime.now().isoformat()
    }

    notes = _load_notes()
    if incident_id not in notes:
        notes[incident_id] = []
    notes[incident_id].insert(0, note)
    _save_notes(notes)

    _broadcast_sse("new_note", {"incident_id": incident_id, "note": note})

    return jsonify({"message": "Note added", "note": note})


# --- Analytics Endpoint (Enhanced) ---
@app.route('/analytics', methods=['GET'])
def analytics():
    try:
        incidents = _load_incidents()
        normalized = [_normalize_incident(i) for i in incidents]
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    total = len(normalized)
    by_category = {}
    by_priority = {"Critical": 0, "High": 0, "Moderate": 0}
    by_status = {}
    resolved_times = []
    ack_times = []
    dispatch_times = []
    venue_counts = {}
    now = datetime.now()

    for inc in normalized:
        cat = inc.get("category", "Other")
        by_category[cat] = by_category.get(cat, 0) + 1

        pri = inc.get("priority", "Moderate")
        if pri in by_priority:
            by_priority[pri] += 1

        st = inc.get("status", "Created")
        by_status[st] = by_status.get(st, 0) + 1

        # Top affected venues
        venue = inc.get("venue_name", "Unknown")
        if venue and venue != "Unknown Venue":
            venue_counts[venue] = venue_counts.get(venue, 0) + 1

        # Compute times from timeline
        timeline = inc.get("status_timeline", [])
        created_ts = None
        ack_ts = None
        dispatch_ts = None
        resolved_ts = None
        for entry in timeline:
            status_name = entry.get("status")
            try:
                ts = datetime.fromisoformat(entry["timestamp"])
            except (ValueError, KeyError):
                continue
            if status_name == "Created" and not created_ts:
                created_ts = ts
            elif status_name == "Acknowledged" and not ack_ts:
                ack_ts = ts
            elif status_name == "Dispatched" and not dispatch_ts:
                dispatch_ts = ts
            elif status_name == "Resolved" and not resolved_ts:
                resolved_ts = ts

        if created_ts:
            if ack_ts:
                ack_times.append((ack_ts - created_ts).total_seconds() / 60)
            if dispatch_ts:
                dispatch_times.append((dispatch_ts - created_ts).total_seconds() / 60)
            if resolved_ts:
                resolved_times.append((resolved_ts - created_ts).total_seconds() / 60)

    # Hourly distribution (last 24h)
    hourly = [0] * 24
    for inc in normalized:
        try:
            ts = datetime.fromisoformat(inc.get("timestamp", ""))
            if (now - ts) < timedelta(hours=24):
                hourly[ts.hour] += 1
        except (ValueError, TypeError):
            pass

    # Severity distribution
    severity_dist = [0] * 11  # 0-10
    for inc in normalized:
        s = min(10, max(0, inc.get("severity_score", 0)))
        severity_dist[s] += 1

    avg_resolve = sum(resolved_times) / len(resolved_times) if resolved_times else None
    avg_ack = sum(ack_times) / len(ack_times) if ack_times else None
    avg_dispatch = sum(dispatch_times) / len(dispatch_times) if dispatch_times else None

    # Top venues sorted
    top_venues = sorted(venue_counts.items(), key=lambda x: x[1], reverse=True)[:8]

    # Resolution rate
    resolved_count = by_status.get("Resolved", 0)
    resolution_rate = round((resolved_count / total) * 100, 1) if total > 0 else 0

    # Affected people total
    total_affected = sum(inc.get("affected_people_count", 1) for inc in normalized)

    return jsonify({
        "total_incidents": total,
        "by_category": by_category,
        "by_priority": by_priority,
        "by_status": by_status,
        "avg_resolve_minutes": round(avg_resolve, 1) if avg_resolve else None,
        "avg_ack_minutes": round(avg_ack, 1) if avg_ack else None,
        "avg_dispatch_minutes": round(avg_dispatch, 1) if avg_dispatch else None,
        "hourly_distribution": hourly,
        "severity_distribution": severity_dist,
        "resolved_count": resolved_count,
        "active_count": total - resolved_count,
        "resolution_rate": resolution_rate,
        "total_affected_people": total_affected,
        "top_venues": [{"venue": v, "count": c} for v, c in top_venues],
    })


# --- AI Copilot Endpoint ---
@app.route('/ai_copilot', methods=['POST'])
def ai_copilot():
    from ai_core import generate_copilot_response
    data = request.json or {}
    query = str(data.get("query", "")).strip()
    if not query:
        return jsonify({"error": "Query is required."}), 400

    try:
        incidents = _load_incidents()
        normalized = [_normalize_incident(i) for i in incidents]
        # Build summary for AI
        summaries = [
            {
                "id": i.get("id"),
                "category": i.get("category"),
                "priority": i.get("priority"),
                "severity_score": i.get("severity_score"),
                "status": i.get("status"),
                "summary": i.get("summary") or i.get("original_message", "")[:100],
                "venue_name": i.get("venue_name"),
                "affected_people_count": i.get("affected_people_count", 1),
                "coordinates": i.get("coordinates"),
            }
            for i in normalized
        ]
        result = generate_copilot_response(query, summaries)
        return jsonify(result)
    except Exception as e:
        log.error("AI Copilot error: %s", e)
        return jsonify({"error": str(e)}), 500


# --- AI Triage Endpoint ---
@app.route('/ai_triage/<incident_id>', methods=['GET'])
def ai_triage(incident_id):
    from ai_core import generate_triage_plan
    try:
        incidents = _load_incidents()
        target = None
        for inc in incidents:
            if str(inc.get("id")) == str(incident_id):
                target = _normalize_incident(inc)
                break
        if not target:
            return jsonify({"error": "Incident not found."}), 404

        triage = generate_triage_plan(target)
        return jsonify(triage)
    except Exception as e:
        log.error("Triage error: %s", e)
        return jsonify({"error": str(e)}), 500


# --- Risk Assessment Endpoint ---
@app.route('/risk_assessment', methods=['GET'])
def risk_assessment():
    from ai_core import assess_cluster_risk
    try:
        incidents = _load_incidents()
        normalized = [_normalize_incident(i) for i in incidents]
        zones = assess_cluster_risk(normalized)
        return jsonify(zones)
    except Exception as e:
        log.error("Risk assessment error: %s", e)
        return jsonify({"error": str(e)}), 500


# --- Health Check ---
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "gemini": bool(os.getenv("GEMINI_API_KEY")),
            "google_maps": bool(os.getenv("GOOGLE_MAPS_API_KEY")),
            "webhook": bool(EMERGENCY_WEBHOOK_URL),
        },
        "sse_clients": len(_sse_clients),
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
