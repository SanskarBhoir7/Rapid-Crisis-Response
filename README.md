# Mumbai Crisis Command Center (v3.0) 🚨

A **highly responsive, AI-driven disaster response system** designed for the scale and complexity of Mumbai. This project integrates live fleet tracking, event-driven situational awareness, and deep **Google Gemini AI integration** to assist operators in critical decision-making.

> **Built for the Google AI Hackathon** 🏆

<img width="1914" height="1078" alt="Dashboard screenshot" src="https://github.com/user-attachments/assets/1716ad98-cf97-494d-8604-968b7a0802f9" />

## ✨ Key Features (v3.0 Hackathon Enhancements)

- **🤖 AI Crisis Copilot (Gemini-Powered)**: Natural language querying of the incident state, resources, and live conditions. 
- **🏥 Smart Triage & Risk Matrix**: Intelligent, automatic triage generation for critical incidents, providing actionable priority steps and ETA estimates.
- **🚨 Escalation Intelligence**: Dynamic banners alert operators about unacknowledged critical incidents, resource exhaustion, and geographic clustering.
- **⌨️ Command Palette (Ctrl+K)**: Frictionless keyboard-centric navigation and rapid action execution.
- **📊 Real-time Analytics Dashboard**: 8 KPIs and 5 data visualizations parsing fleet capacity and incident trends.
- **🎨 Glassmorphic 'Dark Mode' UI**: A sleek, accessible, high-contrast visual design engineered for extended control room operations.

## 🛠 Tech Stack

- **Frontend**: React 19, Framer Motion, Chart.js, Lucide Icons, `@vis.gl/react-google-maps`
- **Backend**: Python, Flask, Server-Sent Events (SSE)
- **AI & Integrations**: **Google Gemini (1.5 Flash)**, Google Maps Platform

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 18+ and npm
- Python 3.8+
- Google Maps API key
- Google Gemini API key

### 1. Configure Environment Variables

**Backend (`backend/.env`)**:
```env
GEMINI_API_KEY=your_gemini_key_here
GOOGLE_MAPS_API_KEY=your_maps_key_here
GEMINI_MODEL=gemini-1.5-flash
EMERGENCY_WEBHOOK_URL=
```

**Frontend (`disaster-response-dashboard/.env`)**:
```env
REACT_APP_GOOGLE_MAPS_API_KEY=your_maps_key_here
```

### 2. Start the Backend API

Open **Terminal 1**:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate # Mac/Linux
pip install -r requirements.txt
python app.py
```
*Backend runs on `http://127.0.0.1:5001`*

### 3. Start the React Frontend

Open **Terminal 2**:
```bash
cd disaster-response-dashboard
npm install
npm start
```
*Frontend runs on `http://localhost:3000`*

---

## 🧪 Demo Verification Checklist

To verify your system is hackathon-ready, perform the following end-to-end checks:

1. **Boot Sequence**: Confirm the "Disaster OS" boot animation loads smoothly.
2. **AI Copilot**: Click the "AI" button in the header (or use Ctrl+K). Ask: *"What is the most critical incident right now?"* 
3. **Smart Triage**: Click any critical incident on the map. Verify the AI Triage section populates with a structured plan.
4. **Fleet Dispatch**: Assign an Ambulance to a newly reported incident. Watch the animated polyline route update and the capacity gauge adjust.
5. **Analytics**: Toggle the Analytics view in the header. Verify the severity distribution and resolution rate charts accurately reflect the live feed.

---

## 📁 Architecture Overview

- **`App.js`**: React core, managing SSE subscriptions, Google Maps integration, and state.
- **`app.py`**: Flask API handling routing, validation, and real-time SSE event broadcasting.
- **`ai_core.py`**: The intelligence layer. Interfaces with Gemini API using robust local-fallback heuristics.
- **`processed_data.json`**: Pre-loaded with 18 high-fidelity, diverse Mumbai crisis scenarios for demonstration purposes.
