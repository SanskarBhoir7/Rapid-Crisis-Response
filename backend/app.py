import json
import os
import time
import requests
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

app = Flask(__name__)
CORS(app)

# --- Configuration ---
PROCESSED_DATA_FILE = str(BASE_DIR / "processed_data.json")
BRIDGE_EVENTS_FILE = str(BASE_DIR / "bridge_events.json")
RESCUE_HQ_COORDS = "18.9486,72.8336"
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
EMERGENCY_WEBHOOK_URL = os.getenv("EMERGENCY_WEBHOOK_URL")

if not GOOGLE_MAPS_API_KEY:
    print("Warning: GOOGLE_MAPS_API_KEY is not set. Route and nearby-place endpoints will return 503.")


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
        print(f"[Bridge] EMERGENCY_WEBHOOK_URL not configured. Mock sent: {event_type} for incident {incident.get('id')}")
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
        print(f"[Bridge] Failed to send webhook event: {e}")
        result = {"delivered": False, "mode": "webhook", "error": str(e)}
        _record_bridge_event(event_type, incident, result)
        return result

# --- API Endpoints ---
@app.route('/get_sos_data', methods=['GET'])
def get_sos_data():
    print("\n--- Received request for SOS data ---")
    try:
        all_data = _load_incidents()
        normalized_data = [_normalize_incident(item) for item in all_data]
        filtered_data = [
            item for item in normalized_data
            if item.get("coordinates") and item.get("authenticity_score", 0) >= 4
        ]
        sorted_data = sorted(filtered_data, key=lambda x: x['severity_score'], reverse=True)
        print(f"Returning {len(sorted_data)} pre-processed and filtered messages.")
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
    print(f"Received new incident report: {data}")
    
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
            
        print("Incident saved successfully.")
        return jsonify({"message": "Incident reported successfully", "incident": normalized_incident})

    except Exception as e:
        print(f"Error saving incident: {e}")
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/panic_alert', methods=['POST'])
def panic_alert():
    data = request.json or {}
    print(f"Received panic alert: {data}")

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
        print("Panic alert saved successfully.")
        return jsonify({"message": "Panic alert created", "incident": normalized_incident})
    except Exception as e:
        print(f"Error saving panic alert: {e}")
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

    return jsonify({"message": "Incident status updated", "incident": incident})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
