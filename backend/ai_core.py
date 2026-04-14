import json
import os
import socket
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, cast

import google.generativeai as genai
import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

# --- CONFIGURATION ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

if not GEMINI_API_KEY:
    print("Warning: GEMINI_API_KEY is not set. AI analysis will use local fallback logic.")
if not GOOGLE_MAPS_API_KEY:
    print("Warning: GOOGLE_MAPS_API_KEY is not set. Geocoding will be skipped.")

_genai_module: Any = genai
if GEMINI_API_KEY:
    configure_fn = cast(Callable[..., Any] | None, getattr(_genai_module, "configure", None))
    if callable(configure_fn):
        configure_fn(api_key=GEMINI_API_KEY)


def _build_model_candidates():
    """Build preferred model list; user-provided model is always tried first."""
    defaults = [
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
    ]
    return [GEMINI_MODEL] + [m for m in defaults if m != GEMINI_MODEL]


def _resolve_gemini_model() -> Any | None:
    """
    Resolve a working model for this API key.
    Avoids network calls during import so offline/sandboxed environments do not hang.
    """
    if not GEMINI_API_KEY:
        return None

    model_cls = cast(Callable[..., Any] | None, getattr(_genai_module, "GenerativeModel", None))
    if not callable(model_cls):
        print("Warning: google.generativeai.GenerativeModel is unavailable in this environment.")
        return None

    for candidate in _build_model_candidates():
        try:
            print(f"Gemini model candidate: {candidate}")
            return model_cls(candidate)
        except Exception as e:
            print(f"Warning: Could not initialize Gemini model '{candidate}'. Reason: {e}")
    return None


gemini_model = _resolve_gemini_model()
_gemini_reachability_cache: dict[str, bool | float | None] = {"ok": None, "checked_at": 0.0}


def _can_reach_gemini_host() -> bool:
    now = time.time()
    cached_ok = _gemini_reachability_cache["ok"]
    checked_at = _gemini_reachability_cache["checked_at"]
    if isinstance(cached_ok, bool) and isinstance(checked_at, (int, float)) and (now - checked_at) < 60:
        return cached_ok

    try:
        with socket.create_connection(("generativelanguage.googleapis.com", 443), timeout=1.5):
            _gemini_reachability_cache["ok"] = True
    except OSError:
        _gemini_reachability_cache["ok"] = False

    _gemini_reachability_cache["checked_at"] = now
    return bool(_gemini_reachability_cache["ok"])


def _generate_with_gemini(prompt: str) -> Any | None:
    """Single wrapper so repeated model errors don't spam every request forever."""
    global gemini_model
    if not gemini_model:
        return None
    if not _can_reach_gemini_host():
        return None
    try:
        return gemini_model.generate_content(prompt, request_options={"timeout": 12})
    except Exception as e:
        print(f"Gemini request failed: {e}")
        # Disable after hard model-not-found style failures to reduce noisy logs.
        if "not found" in str(e).lower() or "404" in str(e):
            gemini_model = None
        return None


def _extract_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    stripped = text.strip().replace("```json", "").replace("```", "").strip()
    try:
        parsed = json.loads(stripped)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(stripped[start:end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _extract_json_array(text: str) -> list[Any] | None:
    """Extract a JSON array from potentially messy LLM output."""
    if not text:
        return None
    stripped = text.strip().replace("```json", "").replace("```", "").strip()
    try:
        parsed = json.loads(stripped)
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        pass

    start = stripped.find("[")
    end = stripped.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(stripped[start:end + 1])
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


def _safe_need_types(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        val = value.strip()
        return [val] if val else []
    return []


def _local_analysis(message: str) -> dict[str, Any]:
    text = str(message or "").strip()
    lower = text.lower()

    location = "Unknown"
    if " at " in lower:
        location = text[lower.rfind(" at ") + 4:].strip(" .,!?:;")

    urgency = "Urgent"
    need_type = "Rescue"
    authenticity_score = 7
    flags = []

    if any(token in lower for token in ["fire", "explosion", "smoke", "trapped", "collapse"]):
        urgency = "Life-threatening"
        need_type = "Rescue"
        authenticity_score = 9
    elif any(token in lower for token in ["injury", "bleeding", "heart", "medical", "unconscious"]):
        urgency = "Life-threatening"
        need_type = "Medical"
        authenticity_score = 9
    elif any(token in lower for token in ["food", "water", "supplies"]):
        urgency = "Minor"
        need_type = "Supplies"

    if location == "Unknown":
        flags.append("vague location")
        authenticity_score = max(4, authenticity_score - 1)

    if any(token in lower for token in ["http://", "https://", "buy now", "subscribe"]):
        flags.append("spam-like content")
        authenticity_score = max(1, authenticity_score - 3)

    return {
        "location": location,
        "urgency": urgency,
        "need_type": need_type,
        "summary": text[:180] if text else "No details provided.",
        "authenticity_score": authenticity_score,
        "reasoning": "Local fallback classifier used because Gemini was unavailable.",
        "flags": flags,
    }


def _parse_analysis_or_fallback(message: str, response_text: str) -> dict[str, Any]:
    parsed = _extract_json_object(response_text)
    if parsed:
        return parsed
    return _local_analysis(message)


# --- FUNCTION 1: GEMINI ANALYSIS (ENHANCED) ---
def analyze_sos_with_gemini(message: str) -> dict[str, Any]:
    """
    Analyzes an SOS message for data extraction and authenticity assessment.
    """
    prompt = f"""
    You are a sophisticated AI for a disaster response system. Your task is to analyze an incoming SOS message with two goals: data extraction and authenticity assessment.

    Part 1: Data Extraction
    Extract the following fields:
    1. location: The specific physical location (e.g., "Andheri station", "near Nagpur bridge"). If none, return "Unknown".
    2. urgency: Classify as 'Life-threatening', 'Urgent', or 'Minor'.
    3. need_type: Classify as 'Rescue', 'Medical', 'Food', 'Shelter', 'Supplies', or 'Infrastructure'.
    4. summary: A one-sentence summary of the request.

    Part 2: Authenticity Assessment
    Critically analyze the message content to determine likely authenticity:
    1. authenticity_score: Integer from 1 (very likely fake/spam) to 10 (very likely authentic).
    2. reasoning: Brief one-sentence explanation.
    3. flags: List of suspicious keywords/patterns. Use [] if none.

    Return output only as one valid JSON object.
    Message: "{message}"
    """
    try:
        response = _generate_with_gemini(prompt)
        if response and getattr(response, "text", None):
            return _parse_analysis_or_fallback(message, response.text)
        return _local_analysis(message)
    except Exception as e:
        print(f"Gemini analysis failed: {e}")
        return _local_analysis(message)


# --- FUNCTION 2: GEOLOCATION ---
def get_coordinates(location_text: str) -> dict[str, float] | None:
    """Converts location text to coordinates using the Google Maps Geocoding API."""
    if not location_text or location_text == "Unknown":
        print(f"Skipping geocoding because location is '{location_text}'.")
        return None

    if not GOOGLE_MAPS_API_KEY:
        print("Skipping geocoding because GOOGLE_MAPS_API_KEY is not set.")
        return None

    params = {
        "address": location_text,
        "key": GOOGLE_MAPS_API_KEY
    }
    url = "https://maps.googleapis.com/maps/api/geocode/json"

    print(f"Attempting to geocode location: '{location_text}'")

    try:
        response = requests.get(url, params=params, timeout=8)
        response.raise_for_status()
        result = response.json()

        if result.get("status") == "OK":
            coordinates = result["results"][0]["geometry"]["location"]
            print(f"Successfully found coordinates: {coordinates}")
            return coordinates

        print(f"Geocoding failed. Status: {result.get('status')}")
        if "error_message" in result:
            print(f"Error Message: {result['error_message']}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"Geocoding request failed with an exception: {e}")
        return None


# --- FUNCTION 3: SEVERITY SCORING ---
def assign_severity_score(analysis: dict[str, Any]) -> int:
    if not analysis:
        return 0

    urgency = analysis.get("urgency", "")
    need_types = _safe_need_types(analysis.get("need_type", ""))
    urgency_scores = {"Life-threatening": 10, "Urgent": 6, "Minor": 2}
    need_type_scores = {"Rescue": 5, "Medical": 5, "Infrastructure": 3, "Shelter": 2, "Food": 1, "Supplies": 1}

    score = urgency_scores.get(urgency, 0)
    if need_types:
        score += max(need_type_scores.get(item, 0) for item in need_types)
    return score


# --- ORCHESTRATOR ---
def process_sos_message(message_id: int, text: str) -> dict[str, Any]:
    print(f"Processing message {message_id}: '{text}'")
    analysis = analyze_sos_with_gemini(text)

    location_text = analysis.get("location")
    location_query = location_text
    if location_query and location_query != "Unknown" and "mumbai" not in location_query.lower():
        location_query = f"{location_query}, Mumbai"

    coordinates = get_coordinates(location_query) if location_query else None
    severity = assign_severity_score(analysis)

    return {
        "id": message_id,
        "original_message": text,
        "location_text": location_text,
        "urgency": analysis.get("urgency"),
        "need_type": analysis.get("need_type"),
        "summary": analysis.get("summary"),
        "severity_score": severity,
        "coordinates": coordinates,
        "authenticity_score": analysis.get("authenticity_score"),
        "reasoning": analysis.get("reasoning"),
        "flags": analysis.get("flags", [])
    }


# --- FUNCTION 4: SITUATION OVERVIEW ---
def generate_situation_report() -> dict[str, Any]:
    """
    Generates a brief summary of Mumbai conditions based on time of day using Gemini.
    """
    current_time = datetime.now().strftime("%I:%M %p")

    prompt = f"""
    You are an AI reporting on current conditions in Mumbai for a disaster dashboard.
    Current Time: {current_time}.

    Return a JSON object with:
    1. temperature: realistic temperature string (example: "28 C")
    2. condition: short weather description
    3. insight: one strategic sentence for emergency responders
    """

    try:
        response = _generate_with_gemini(prompt)
        if response and getattr(response, "text", None):
            parsed = _extract_json_object(response.text)
            if parsed:
                return parsed
        raise ValueError("No Gemini response available")
    except Exception as e:
        print(f"Situation Report generation failed: {e}")
        return {
            "temperature": "30 C",
            "condition": "Clear",
            "insight": "System online. Monitoring all frequencies."
        }


# --- FUNCTION 5: AI COPILOT ---
def generate_copilot_response(query: str, incidents_summary: list[dict]) -> dict[str, Any]:
    """
    Processes operator natural-language queries against current incident data.
    Returns a structured AI response with analysis and recommendations.
    """
    incidents_text = json.dumps(incidents_summary[:20], indent=2, default=str)

    prompt = f"""
You are an AI Copilot for a disaster response command center in Mumbai. An operator is asking you a question about the current crisis situation.

Current Incident Data (summary):
{incidents_text}

Operator's question: "{query}"

Respond with a JSON object containing:
1. "answer": A clear, concise answer to the operator's question (2-4 sentences max)
2. "recommendations": An array of 1-3 actionable recommendations (short strings)
3. "priority_flag": "critical", "warning", or "info" depending on urgency of your findings
4. "related_incident_ids": Array of incident IDs most relevant to the query (can be empty)

Be direct, professional, and action-oriented. Do NOT use markdown in the answer.
"""

    try:
        response = _generate_with_gemini(prompt)
        if response and getattr(response, "text", None):
            parsed = _extract_json_object(response.text)
            if parsed:
                return parsed
    except Exception as e:
        print(f"Copilot query failed: {e}")

    # Local fallback
    return _local_copilot_response(query, incidents_summary)


def _local_copilot_response(query: str, incidents: list[dict]) -> dict[str, Any]:
    """Fallback copilot when Gemini is unavailable."""
    lower = query.lower()
    total = len(incidents)
    critical = [i for i in incidents if i.get("priority") == "Critical"]
    unresolved = [i for i in incidents if i.get("status") != "Resolved"]
    categories = {}
    for i in incidents:
        cat = i.get("category", "Other")
        categories[cat] = categories.get(cat, 0) + 1

    if "critical" in lower or "urgent" in lower or "worst" in lower:
        if critical:
            top = critical[0]
            return {
                "answer": f"There are {len(critical)} critical incidents. The most severe is '{top.get('summary', top.get('original_message', 'Unknown'))}' at {top.get('venue_name', 'Unknown location')} with severity {top.get('severity_score', '?')}/10.",
                "recommendations": ["Prioritize dispatch to highest-severity incident", "Check resource capacity for multi-unit response"],
                "priority_flag": "critical",
                "related_incident_ids": [i.get("id") for i in critical[:3]]
            }
    if "how many" in lower or "count" in lower or "total" in lower:
        return {
            "answer": f"Currently tracking {total} incidents. {len(critical)} are critical, {len(unresolved)} are unresolved. Categories: {', '.join(f'{k}: {v}' for k, v in categories.items())}.",
            "recommendations": ["Monitor unresolved critical incidents closely"],
            "priority_flag": "info",
            "related_incident_ids": []
        }

    return {
        "answer": f"I'm analyzing the situation. Currently tracking {total} incidents with {len(critical)} critical and {len(unresolved)} unresolved. Ask me about specific incidents, resource status, or area analysis for targeted insights.",
        "recommendations": ["Try asking about specific areas or incident types", "Ask about resource capacity or response times"],
        "priority_flag": "info",
        "related_incident_ids": []
    }


# --- FUNCTION 6: AI TRIAGE ---
def generate_triage_plan(incident: dict) -> dict[str, Any]:
    """
    Given an incident, generate an AI-powered triage plan with recommended actions.
    """
    incident_text = json.dumps({
        "category": incident.get("category"),
        "severity_score": incident.get("severity_score"),
        "original_message": incident.get("original_message"),
        "urgency": incident.get("urgency"),
        "need_type": incident.get("need_type"),
        "affected_people_count": incident.get("affected_people_count"),
        "venue_name": incident.get("venue_name"),
        "floor": incident.get("floor"),
        "status": incident.get("status"),
    }, indent=2, default=str)

    prompt = f"""
You are a disaster response triage AI. Given the incident below, provide a structured triage plan.

Incident:
{incident_text}

Return a JSON object with:
1. "risk_level": "extreme", "high", "moderate", or "low"
2. "immediate_actions": Array of 2-4 immediate action strings (what first responders should do NOW)
3. "resources_needed": Array of resource types needed (e.g., "2x Ambulance", "HazMat Team", "Fire Engine with Ladder")
4. "estimated_response_time": String like "8-12 minutes" 
5. "special_considerations": Array of 1-2 things to watch out for (e.g., "Possible secondary collapse", "Toxic fumes — require PPE")
6. "evacuation_needed": boolean

Be precise and actionable. No markdown.
"""

    try:
        response = _generate_with_gemini(prompt)
        if response and getattr(response, "text", None):
            parsed = _extract_json_object(response.text)
            if parsed:
                return parsed
    except Exception as e:
        print(f"Triage plan generation failed: {e}")

    # Local fallback
    return _local_triage(incident)


def _local_triage(incident: dict) -> dict[str, Any]:
    """Fallback triage when Gemini is unavailable."""
    severity = incident.get("severity_score", 5)
    category = incident.get("category", "General Emergency")
    affected = incident.get("affected_people_count", 1)

    risk = "moderate"
    if severity >= 9:
        risk = "extreme"
    elif severity >= 7:
        risk = "high"

    actions = ["Secure perimeter around incident zone", "Assess casualties and begin triage"]
    resources = ["1x Police Patrol"]
    considerations = []
    evacuation = False

    if "Fire" in category:
        actions = ["Evacuate building immediately", "Establish fire perimeter", "Set up triage area for burn victims", "Check for gas lines"]
        resources = ["2x Fire Engine", "1x Ambulance", "1x Police Patrol"]
        considerations = ["Risk of structural collapse after fire", "Check for trapped persons on upper floors"]
        evacuation = True
    elif "Medical" in category:
        actions = ["Begin first aid / CPR if needed", "Clear area for ambulance access", "Gather patient history if possible"]
        resources = [f"{'2x' if affected > 10 else '1x'} Ambulance (ALS)", "Medical supplies kit"]
        considerations = ["Maintain patient airway", "Monitor for shock symptoms"]
    elif "Flood" in category:
        actions = ["Deploy rescue boats to stranded areas", "Establish dry evacuation rally point", "Cut power to flooded zones"]
        resources = ["1x Rescue Boat", "1x Police Patrol", "Water pumps"]
        considerations = ["Risk of electrocution from submerged cables", "Water contamination risk"]
        evacuation = True
    elif "Collapse" in category or "Structure" in category:
        actions = ["Do NOT enter unstable structure", "Use thermal imaging to locate trapped", "Begin debris removal at safe entry points"]
        resources = ["1x NDRF Team", "1x Fire Engine", "2x Ambulance", "Heavy equipment"]
        considerations = ["Secondary collapse risk — maintain exclusion zone", "Listen for survivor signals before using heavy machinery"]
        evacuation = True
    elif "Chemical" in category or "Gas" in category:
        actions = ["Evacuate downwind area immediately", "Deploy HazMat team with PPE", "Set up decontamination zone"]
        resources = ["1x HazMat Unit", "2x Ambulance", "1x Fire Engine"]
        considerations = ["Wind direction may shift — monitor continuously", "All responders MUST wear respiratory PPE"]
        evacuation = True

    time_estimate = "5-8 minutes" if severity >= 8 else "10-15 minutes"

    return {
        "risk_level": risk,
        "immediate_actions": actions,
        "resources_needed": resources,
        "estimated_response_time": time_estimate,
        "special_considerations": considerations,
        "evacuation_needed": evacuation
    }


# --- FUNCTION 7: RISK ASSESSMENT ---
def assess_cluster_risk(incidents: list[dict]) -> list[dict]:
    """
    Analyze geographic clusters of incidents to identify risk zones.
    Returns risk zone data for heatmap rendering.
    """
    # Build a summary for Gemini
    active_incidents = [
        {
            "id": i.get("id"),
            "category": i.get("category"),
            "severity_score": i.get("severity_score"),
            "coordinates": i.get("coordinates"),
            "status": i.get("status"),
            "affected_people_count": i.get("affected_people_count", 1)
        }
        for i in incidents
        if i.get("coordinates") and i.get("status") != "Resolved"
    ]

    if not active_incidents:
        return []

    summary_text = json.dumps(active_incidents[:15], indent=2, default=str)

    prompt = f"""
You are a disaster risk assessment AI analyzing incident clusters in Mumbai.

Active incidents:
{summary_text}

Identify 2-4 geographic risk zones based on incident clustering and severity patterns.

Return a JSON array where each element has:
1. "zone_name": Human-readable area name  
2. "center_lat": float latitude of zone center
3. "center_lng": float longitude of zone center
4. "risk_level": "critical", "high", "moderate"
5. "radius_km": float, approximate radius
6. "reasoning": One sentence why this is a risk zone
7. "incident_count": Number of incidents in this zone

Return ONLY the JSON array, no other text.
"""

    try:
        response = _generate_with_gemini(prompt)
        if response and getattr(response, "text", None):
            parsed = _extract_json_array(response.text)
            if parsed:
                return parsed
    except Exception as e:
        print(f"Risk assessment failed: {e}")

    # Local fallback — cluster by proximity
    return _local_risk_assessment(active_incidents)


def _local_risk_assessment(incidents: list[dict]) -> list[dict]:
    """Fallback risk assessment using simple proximity clustering."""
    if not incidents:
        return []

    zones = []
    used = set()

    for i, inc in enumerate(incidents):
        if i in used:
            continue
        coords = inc.get("coordinates", {})
        lat = coords.get("lat", 0)
        lng = coords.get("lng", 0)

        cluster = [inc]
        used.add(i)

        for j, other in enumerate(incidents):
            if j in used:
                continue
            o_coords = other.get("coordinates", {})
            dist = ((lat - o_coords.get("lat", 0)) ** 2 + (lng - o_coords.get("lng", 0)) ** 2) ** 0.5
            if dist < 0.03:  # ~3km threshold
                cluster.append(other)
                used.add(j)

        avg_lat = sum(c.get("coordinates", {}).get("lat", 0) for c in cluster) / len(cluster)
        avg_lng = sum(c.get("coordinates", {}).get("lng", 0) for c in cluster) / len(cluster)
        max_severity = max(c.get("severity_score", 0) for c in cluster)
        total_affected = sum(c.get("affected_people_count", 1) for c in cluster)

        risk = "moderate"
        if max_severity >= 9 or len(cluster) >= 3:
            risk = "critical"
        elif max_severity >= 7 or len(cluster) >= 2:
            risk = "high"

        zone_name = cluster[0].get("category", "Unknown") + " Zone"
        zones.append({
            "zone_name": zone_name,
            "center_lat": round(avg_lat, 4),
            "center_lng": round(avg_lng, 4),
            "risk_level": risk,
            "radius_km": round(1.5 + len(cluster) * 0.5, 1),
            "reasoning": f"{len(cluster)} incident(s) with max severity {max_severity}, {total_affected} people affected.",
            "incident_count": len(cluster)
        })

    return sorted(zones, key=lambda z: {"critical": 0, "high": 1, "moderate": 2}.get(z["risk_level"], 3))


# --- EXAMPLE USAGE ---
if __name__ == "__main__":
    sample_messages = [
        "Family of 4 trapped in our car near Nagpur bridge. My son is having trouble breathing. Urgent medical help needed!",
        "Stuck on the roof at Andheri station, water level rising fast! Need immediate rescue. #MumbaiFloods",
        "We are safe but running out of food and water in our building at Lokhandwala Complex. Need supplies for 20 people.",
        "A building has collapsed near the old post office in Dadar. Heard people screaming."
    ]
    for i, msg in enumerate(sample_messages):
        result = process_sos_message(i + 1, msg)
        print(json.dumps(result, indent=2))
        print("-" * 20)
