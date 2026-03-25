import os
import json
import requests # Use the requests library for cleaner API calls
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# --- CONFIGURATION ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

# Check if keys are loaded
if not GEMINI_API_KEY:
    raise ValueError("Error: GEMINI_API_KEY environment variable not set.")
if not GOOGLE_MAPS_API_KEY:
    raise ValueError("Error: GOOGLE_MAPS_API_KEY environment variable not set.")

genai.configure(api_key=GEMINI_API_KEY)

def _build_model_candidates():
    """Build preferred model list; user-provided model is always tried first."""
    defaults = [
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
    ]
    return [GEMINI_MODEL] + [m for m in defaults if m != GEMINI_MODEL]


def _supports_generate_content(model_info):
    methods = getattr(model_info, "supported_generation_methods", []) or []
    return "generateContent" in methods


def _resolve_gemini_model():
    """
    Resolve a working model for this API key.
    Falls back gracefully if model listing is unavailable.
    """
    candidates = _build_model_candidates()
    try:
        models = list(genai.list_models())
        available = {}
        for model in models:
            model_name = getattr(model, "name", "")
            if not model_name:
                continue
            short_name = model_name.split("models/")[-1]
            available[model_name] = model
            available[short_name] = model

        for candidate in candidates:
            model_info = available.get(candidate)
            if model_info and _supports_generate_content(model_info):
                selected_name = getattr(model_info, "name", candidate).split("models/")[-1]
                print(f"Gemini model selected: {selected_name}")
                return genai.GenerativeModel(selected_name)
    except Exception as e:
        print(f"Warning: Could not list Gemini models, falling back to configured model '{GEMINI_MODEL}'. Reason: {e}")

    # Last attempt: try configured model directly.
    try:
        print(f"Gemini model fallback: {GEMINI_MODEL}")
        return genai.GenerativeModel(GEMINI_MODEL)
    except Exception as e:
        print(f"Warning: Could not initialize Gemini model '{GEMINI_MODEL}'. Reason: {e}")
        return None


gemini_model = _resolve_gemini_model()


def _generate_with_gemini(prompt: str):
    """Single wrapper so repeated model errors don't spam every request forever."""
    global gemini_model
    if not gemini_model:
        return None
    try:
        return gemini_model.generate_content(prompt)
    except Exception as e:
        print(f"Gemini request failed: {e}")
        # Disable after hard model-not-found style failures to reduce noisy logs.
        if "not found" in str(e).lower() or "404" in str(e):
            gemini_model = None
        return None


# --- FUNCTION 1: GEMINI ANALYSIS (NEW ENHANCED VERSION) ---

def analyze_sos_with_gemini(message: str) -> dict:
    """
    Analyzes an SOS message for data extraction AND authenticity assessment.
    """
    prompt = f"""
    You are a sophisticated AI for a disaster response system. Your task is to analyze an incoming SOS message with two goals: data extraction and authenticity assessment.

    **Part 1: Data Extraction**
    Extract the following fields:
    1.  **location**: The specific physical location (e.g., "Andheri station", "near Nagpur bridge"). If none, return "Unknown".
    2.  **urgency**: Classify as 'Life-threatening', 'Urgent', or 'Minor'.
    3.  **need_type**: Classify as 'Rescue', 'Medical', 'Food', 'Shelter', 'Supplies', 'Infrastructure'.
    4.  **summary**: A one-sentence summary of the request.

    **Part 2: Authenticity Assessment**
    Critically analyze the message content to determine its likely authenticity. Provide the following:
    1.  **authenticity_score**: An integer score from 1 (very likely fake/spam) to 10 (very likely authentic).
    2.  **reasoning**: A brief, one-sentence explanation for your score. Consider factors like specificity, vagueness, emotional tone, and presence of spam-like content.
    3.  **flags**: A list of any suspicious keywords or patterns detected (e.g., "vague location", "spam link", "generic plea"). If none, return an empty list [].

    **Return the output ONLY as a single, valid JSON object.**

    **Message:** "{message}"

    **JSON Output:**
    """
    try:
        response = _generate_with_gemini(prompt)
        if not response:
            return None
        # Clean up the response to ensure it's valid JSON
        json_text = response.text.strip().replace("```json", "").replace("```", "")
        return json.loads(json_text)
    except Exception as e:
        print(f"Gemini analysis failed: {e}")
        return None

# --- FUNCTION 2: GEOLOCATION (IMPROVED) ---
# --- FUNCTION 2: GEOLOCATION (IMPROVED FOR DEBUGGING) ---
def get_coordinates(location_text: str) -> dict:
    """Converts a location text into latitude and longitude using Google Maps Geocoding API."""
    if not location_text or location_text == "Unknown":
        print(f"Skipping geocoding because location is '{location_text}'.")
        return None
    
    if not GOOGLE_MAPS_API_KEY:
        print("Skipping geocoding because GOOGLE_MAPS_API_KEY is not set.")
        return None
        
    params = {
        'address': location_text,
        'key': GOOGLE_MAPS_API_KEY
    }
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    
    print(f"Attempting to geocode location: '{location_text}'")
    
    try:
        response = requests.get(url, params=params)
        response.raise_for_status() # Raises an HTTPError for bad responses (4xx or 5xx)
        
        result = response.json()
        
        # --- THIS IS THE NEW DEBUGGING LOGIC ---
        if result['status'] == 'OK':
            coordinates = result['results'][0]['geometry']['location']
            print(f"Successfully found coordinates: {coordinates}")
            return coordinates
        else:
            # Tell us exactly why it failed!
            print(f"Geocoding failed. Status: {result['status']}")
            if 'error_message' in result:
                print(f"Error Message: {result['error_message']}")
            return None
            
    except requests.exceptions.RequestException as e:
        print(f"Geocoding request failed with an exception: {e}")
        return None

# --- FUNCTION 3: SEVERITY SCORING ---
def assign_severity_score(analysis: dict) -> int:
    if not analysis: return 0
    urgency = analysis.get("urgency", "")
    need_type = analysis.get("need_type", "")
    score = 0
    urgency_scores = {"Life-threatening": 10, "Urgent": 6, "Minor": 2}
    need_type_scores = {"Rescue": 5, "Medical": 5, "Infrastructure": 3, "Shelter": 2, "Food": 1, "Supplies": 1}
    score += urgency_scores.get(urgency, 0)
    score += need_type_scores.get(need_type, 0)
    return score

# --- ORCHESTRATOR ---
def process_sos_message(message_id: int, text: str) -> dict:
    print(f"Processing message {message_id}: '{text}'")
    analysis = analyze_sos_with_gemini(text)
    if not analysis:
        return {"id": message_id, "error": "AI analysis failed."}
    
    location_text = analysis.get("location")
    coordinates = get_coordinates(f"{location_text}, Mumbai") if location_text else None
    
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

# --- FUNCTION 4: SITUATION OVERVIEW (NEW) ---
def generate_situation_report() -> dict:
    """
    Generates a brief, realistic 2-sentence summary of Mumbai's current condition 
    (weather/traffic) based on the time of day using Gemini.
    """
    import datetime
    current_time = datetime.datetime.now().strftime("%I:%M %p")
    
    prompt = f"""
    You are an AI reporting on the current status of Mumbai for a disaster dashboard.
    Current Time: {current_time}.
    
    Generate a JSON object with:
    1. "temperature": A realistic temperature for Mumbai at this time (e.g., "28°C").
    2. "condition": Short weather description (e.g., "Humid & Cloudy", "Heavy Rain").
    3. "insight": A 1-sentence strategic insight for emergency responders (e.g., "Expect delays on Western Express Highway due to peak hour traffic.", "High tide expected at 4 PM, monitor coastal areas.").
    
    Make it sound professional and realistic.
    """
    
    try:
        response = _generate_with_gemini(prompt)
        if not response:
            raise ValueError("No Gemini response available")
        json_text = response.text.strip().replace("```json", "").replace("```", "")
        return json.loads(json_text)
    except Exception as e:
        print(f"Situation Report generation failed: {e}")
        return {
            "temperature": "30°C", 
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