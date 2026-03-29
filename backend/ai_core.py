import json
import os
import socket
import time
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
        return gemini_model.generate_content(prompt, request_options={"timeout": 8})
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
    import datetime
    current_time = datetime.datetime.now().strftime("%I:%M %p")

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
