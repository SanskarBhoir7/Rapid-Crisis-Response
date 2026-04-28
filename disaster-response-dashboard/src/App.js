import React, { useState, useEffect, useRef, useCallback } from 'react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { decode } from '@googlemaps/polyline-codec';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, MapPin, Activity, Shield, Flame, Truck, AlertTriangle, Search, BarChart3, Map as MapIcon, Bot, Command, Wifi, WifiOff } from 'lucide-react';
import ReportModal from './ReportModal';
import VehicleDetailPanel from './VehicleDetailPanel';
import IncidentDetailPanel from './IncidentDetailPanel';
import FleetDropdown from './FleetDropdown';
import IntroOverlay from './IntroOverlay';
import NotificationToast from './NotificationToast';
import AnalyticsDashboard from './AnalyticsDashboard';
import AICopilot from './AICopilot';
import CommandPalette from './CommandPalette';
import ResourceCapacityBar from './ResourceCapacityBar';
import EscalationBanner from './EscalationBanner';
import './App.css';

// --- CONTROLS COMPONENT ---
function MapControls({ showTraffic, setShowTraffic }) {
  const map = useMap();
  const trafficLayerRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    trafficLayerRef.current = new window.google.maps.TrafficLayer();
  }, [map]);

  useEffect(() => {
    if (!map || !trafficLayerRef.current) return;
    if (showTraffic) {
      trafficLayerRef.current.setMap(map);
    } else {
      trafficLayerRef.current.setMap(null);
    }
  }, [showTraffic, map]);

  return (
    <div className="map-controls">
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={showTraffic}
          onChange={(e) => setShowTraffic(e.target.checked)}
          aria-label="Toggle traffic layer"
        />
        <span className="slider round"></span>
        <span className="label-text">Traffic</span>
      </label>
    </div>
  );
}

// --- ROUTE POLYLINE COMPONENT ---
function RoutePolyline({ path }) {
  const map = useMap();
  const polylineRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    if (!polylineRef.current) {
      polylineRef.current = new window.google.maps.Polyline({
        geodesic: true,
        strokeColor: '#3b82f6',
        strokeOpacity: 0.8,
        strokeWeight: 6,
      });
      polylineRef.current.setMap(map);
    }
    if (path && path.length > 0) {
      polylineRef.current.setPath(path.map(({ lat, lng }) => ({ lat, lng })));
    } else {
      polylineRef.current.setPath([]);
    }
  }, [map, path]);

  return null;
}

// --- CLOCK COMPONENT ---
function DigitalClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="digital-clock" aria-label="Current time">
      <div className="clock-time">
        {time.toLocaleTimeString('en-US', { hour12: false })}
      </div>
      <div className="clock-date">
        {time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
      </div>
    </div>
  );
}

function toMs(value) {
  const date = new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '--';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

function formatBridgeEventLabel(eventType) {
  return String(eventType || 'bridge_event')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatIncidentSource(source) {
  if (source === 'panic_button') return 'Panic Button';
  if (source === 'manual_report') return 'Manual Report';
  return 'External Feed';
}

function getTimelineStatusTime(incident, status) {
  const timeline = Array.isArray(incident?.status_timeline) ? incident.status_timeline : [];
  const entry = timeline.find((item) => item.status === status);
  return entry ? toMs(entry.timestamp) : null;
}

function calculateResponseKpis(incidents) {
  const now = Date.now();
  const acknowledgeMins = [];
  const dispatchMins = [];
  const resolveMins = [];
  let unresolvedCritical = 0;

  incidents.forEach((incident) => {
    const createdMs = getTimelineStatusTime(incident, 'Created') || toMs(incident.timestamp);
    if (!createdMs) return;

    const acknowledgedMs = getTimelineStatusTime(incident, 'Acknowledged');
    const dispatchedMs = getTimelineStatusTime(incident, 'Dispatched');
    const resolvedMs = getTimelineStatusTime(incident, 'Resolved');

    if (acknowledgedMs && acknowledgedMs >= createdMs) {
      acknowledgeMins.push((acknowledgedMs - createdMs) / 60000);
    }

    if (dispatchedMs && dispatchedMs >= createdMs) {
      dispatchMins.push((dispatchedMs - createdMs) / 60000);
    }

    if (resolvedMs && resolvedMs >= createdMs) {
      resolveMins.push((resolvedMs - createdMs) / 60000);
    }

    const isCritical = (incident.severity_score || 0) >= 8;
    const isResolved = incident.status === 'Resolved' || Boolean(resolvedMs);
    if (isCritical && !isResolved && (now - createdMs) > 5 * 60000) {
      unresolvedCritical += 1;
    }
  });

  const average = (arr) => arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : null;

  return {
    avgAcknowledgeMins: average(acknowledgeMins),
    avgDispatchMins: average(dispatchMins),
    avgResolveMins: average(resolveMins),
    unresolvedCritical
  };
}

// --- CONNECTION STATUS ---
function ConnectionStatus({ connected }) {
  return (
    <div className={`connection-status ${connected ? 'online' : 'offline'}`} role="status" aria-label={connected ? 'Connected to server' : 'Disconnected from server'}>
      {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
    </div>
  );
}

// --- MAIN APP COMPONENT ---
function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [sosData, setSosData] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTraffic, setShowTraffic] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [panicSubmitting, setPanicSubmitting] = useState(false);
  const [situation, setSituation] = useState({ temp: "--", cond: "Loading...", insight: "Connecting to AI satellite..." });
  const [bridgeMode, setBridgeMode] = useState({ mode: 'unknown', webhook_configured: false });
  const [bridgeEvents, setBridgeEvents] = useState([]);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterPriority, setFilterPriority] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [showCopilot, setShowCopilot] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [connected, setConnected] = useState(true);
  // eslint-disable-next-line no-unused-vars
  const [dismissedEscalations, setDismissedEscalations] = useState(new Set());
  const alertAudioRef = useRef(null);
  const knownIdsRef = useRef(new Set());
  const [kpis, setKpis] = useState({
    avgAcknowledgeMins: null,
    avgDispatchMins: null,
    avgResolveMins: null,
    unresolvedCritical: 0
  });

  // --- SMART DISPATCH SYSTEM ---
  const [resources, setResources] = useState([
    {
      id: 'amb-1', type: 'ambulance', status: 'IDLE', lat: 19.0760, lng: 72.8777, name: 'Ambulance 1',
      details: { driver: 'Ramesh K.', contact: '9820098200', capacity: '2 Patients', equipment: 'ALS' }
    },
    {
      id: 'amb-2', type: 'ambulance', status: 'IDLE', lat: 19.0200, lng: 72.8400, name: 'Ambulance 2',
      details: { driver: 'Suresh P.', contact: '9820098201', capacity: '1 Patient', equipment: 'BLS' }
    },
    {
      id: 'pol-1', type: 'police', status: 'IDLE', lat: 19.0800, lng: 72.8900, name: 'Patrol Alpha',
      details: { driver: 'Insp. Patil', contact: '100-22', capacity: '4 Officers', equipment: 'Riot Gear' }
    },
    {
      id: 'fire-1', type: 'fire', status: 'IDLE', lat: 19.0600, lng: 72.8500, name: 'Fire Engine 4',
      details: { driver: 'Chief Rane', contact: '101-44', capacity: '3000L Water', equipment: 'Ladder' }
    }
  ]);

  const handleIntroComplete = () => {
    setShowIntro(false);
  };

  // --- KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+K / Cmd+K for command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      // Escape to close panels
      if (e.key === 'Escape') {
        if (showCommandPalette) setShowCommandPalette(false);
        else if (showCopilot) setShowCopilot(false);
        else if (selectedIncident) setSelectedIncident(null);
        else if (selectedVehicle) setSelectedVehicle(null);
        else if (showReportModal) setShowReportModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCommandPalette, showCopilot, selectedIncident, selectedVehicle, showReportModal]);

  useEffect(() => {
    const fetchSituation = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/get_situation_update`);
        const data = await res.json();
        if (data.temperature) {
          setSituation({
            temp: data.temperature,
            cond: data.condition,
            insight: data.insight
          });
        }
      } catch (err) {
        console.error("Error fetching situation report:", err);
      }
    };

    const fetchBridgeStatus = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/bridge_status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.mode) {
          setBridgeMode({
            mode: data.mode,
            webhook_configured: Boolean(data.webhook_configured)
          });
        }
      } catch (err) {
        console.error('Error fetching bridge status:', err);
      }
    };

    const fetchSos = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/get_sos_data`);
        if (!res.ok) {
          throw new Error("Failed to connect to backend");
        }

        const data = await res.json();
        const sortedData = data.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

        setSosData(prev => {
          const prevById = new Map(prev.map(item => [item.id, item]));
          const synced = sortedData.map(item => {
            const prevItem = prevById.get(item.id);
            return {
              ...prevItem,
              ...item,
              assigned_vehicle: prevItem?.assigned_vehicle || item.assigned_vehicle
            };
          });

          const syncedIds = new Set(synced.map(item => item.id));
          const localOnly = prev.filter(item => !syncedIds.has(item.id));
          return [...synced, ...localOnly];
        });

        setLoading(false);
        setConnected(true);
      } catch (err) {
        console.error("Error fetching SOS data:", err);
        setLoading(false);
        setConnected(false);
      }
    };

    const fetchBridgeEvents = async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/bridge_events?limit=8`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) {
          setBridgeEvents(data);
        }
      } catch (err) {
        console.error('Error fetching bridge events:', err);
      }
    };

    fetchSituation();
    fetchSos();
    fetchBridgeStatus();
    fetchBridgeEvents();

    // SSE connection for real-time updates
    let eventSource;
    try {
      eventSource = new EventSource(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/stream`);
      eventSource.addEventListener('connected', () => setConnected(true));
      eventSource.addEventListener('new_incident', (e) => {
        try {
          const incident = JSON.parse(e.data);
          setSosData(prev => {
            if (prev.some(i => i.id === incident.id)) return prev;
            return [incident, ...prev];
          });
          if ((incident.severity_score || 0) >= 8) {
            setNotifications(prev => [incident, ...prev].slice(0, 5));
            try { if (alertAudioRef.current) alertAudioRef.current.play().catch(() => {}); } catch (_) {}
          }
        } catch (_) {}
      });
      eventSource.addEventListener('status_update', (e) => {
        try {
          const updated = JSON.parse(e.data);
          setSosData(prev => prev.map(inc => inc.id === updated.id ? updated : inc));
          setSelectedIncident(prev => prev && prev.id === updated.id ? updated : prev);
        } catch (_) {}
      });
      eventSource.onerror = () => setConnected(false);
    } catch (_) {}

    const sosInterval = setInterval(fetchSos, 8000);
    const situationInterval = setInterval(fetchSituation, 60000);
    const bridgeStatusInterval = setInterval(fetchBridgeStatus, 60000);
    const bridgeEventsInterval = setInterval(fetchBridgeEvents, 7000);

    return () => {
      clearInterval(sosInterval);
      clearInterval(situationInterval);
      clearInterval(bridgeStatusInterval);
      clearInterval(bridgeEventsInterval);
      if (eventSource) eventSource.close();
    };
  }, []);

  const fetchRouteForVehicle = useCallback(async (vehicle, target) => {
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/get_route?lat=${target.coordinates.lat}&lng=${target.coordinates.lng}&start_lat=${vehicle.lat}&start_lng=${vehicle.lng}`);
      if (res.ok) {
        const data = await res.json();
        if (data.overview_polyline) {
          const decoded = decode(data.overview_polyline);
          const newPath = decoded.map(([lat, lng]) => ({ lat, lng }));
          setResources(prev => prev.map(r => {
            if (r.id === vehicle.id) {
              return { ...r, path: newPath };
            }
            return r;
          }));
        }
      }
    } catch (err) {
      console.error("Routing Error:", err);
      setResources(prev => prev.map(r => {
        if (r.id === vehicle.id) {
          return { ...r, path: [{ lat: vehicle.lat, lng: vehicle.lng }, target.coordinates] };
        }
        return r;
      }));
    }
  }, []);

  const updateIncidentStatus = useCallback(async (incidentId, status, options = {}) => {
    const payload = {
      incident_id: incidentId,
      status,
      actor: options.actor || 'operator',
      note: options.note || `Status changed to ${status}`
    };

    if (options.assigned_vehicle !== undefined) {
      payload.assigned_vehicle = options.assigned_vehicle;
    }

    const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/update_incident_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errorMessage = 'Failed to update incident status.';
      try {
        const errPayload = await res.json();
        if (errPayload?.error) {
          errorMessage = errPayload.error;
        }
      } catch (_) {}
      throw new Error(errorMessage);
    }

    const responsePayload = await res.json();
    if (responsePayload?.incident) {
      setSosData(prev => prev.map(inc => inc.id === responsePayload.incident.id ? responsePayload.incident : inc));
      setSelectedIncident(prev => prev && prev.id === responsePayload.incident.id ? responsePayload.incident : prev);
    }
  }, []);

  const assignVehicle = useCallback(async (vehicleId, incidentId) => {
    const vehicle = resources.find(r => r.id === vehicleId);
    if (!vehicle) return;

    setResources(prev => prev.map(res => {
      if (res.id === vehicleId) {
        return {
          ...res,
          status: incidentId ? 'DISPATCHED' : 'IDLE',
          target_incident_id: incidentId,
          path: [],
          pathIndex: 0
        };
      }
      return res;
    }));

    if (incidentId) {
      setSosData(prev => prev.map(inc => {
        if (inc.id === incidentId) {
          return { ...inc, assigned_vehicle: vehicleId, status: 'Dispatched' };
        }
        return inc;
      }));

      try {
        await updateIncidentStatus(incidentId, 'Dispatched', {
          actor: 'dispatcher',
          note: `Unit ${vehicleId} dispatched`,
          assigned_vehicle: vehicleId
        });
      } catch (err) {
        console.error('Failed to persist dispatch status:', err);
      }

      const target = sosData.find(i => i.id === incidentId);
      if (target && target.coordinates) {
        fetchRouteForVehicle(vehicle, target);
      }
    } else if (vehicle.target_incident_id) {
      try {
        await updateIncidentStatus(vehicle.target_incident_id, 'Acknowledged', {
          actor: 'dispatcher',
          note: `Unit ${vehicleId} recalled`,
          assigned_vehicle: null
        });
      } catch (err) {
        console.error('Failed to persist recall status:', err);
      }
    }
  }, [fetchRouteForVehicle, resources, sosData, updateIncidentStatus]);

  const handleIncidentStatusChange = async (incidentId, status) => {
    try {
      await updateIncidentStatus(incidentId, status, {
        actor: 'operator',
        note: `Manually set to ${status}`
      });
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to update incident status.');
    }
  };

  // AUTO DISPATCH LOGIC
  useEffect(() => {
    sosData.forEach(incident => {
      if (incident.severity_score >= 7 && !incident.assigned_vehicle) {
        let requiredType = 'police';
        if (incident.need_type?.includes('Medical')) requiredType = 'ambulance';
        if (incident.need_type?.includes('Fire')) requiredType = 'fire';

        const availableVehicles = resources.filter(r => r.type === requiredType && r.status === 'IDLE');

        if (availableVehicles.length > 0) {
          let nearest = availableVehicles[0];
          let minDist = 9999;

          availableVehicles.forEach(v => {
            const d = Math.sqrt(Math.pow(v.lat - incident.coordinates.lat, 2) + Math.pow(v.lng - incident.coordinates.lng, 2));
            if (d < minDist) {
              minDist = d;
              nearest = v;
            }
          });
          assignVehicle(nearest.id, incident.id);
        }
      }
    });
  }, [assignVehicle, resources, sosData]);

  // SIMULATE MOVEMENT
  useEffect(() => {
    const moveInterval = setInterval(() => {
      setResources(prev => prev.map(res => {
        if (res.status === 'DISPATCHED' && res.path && res.path.length > 0) {
          const targetNode = res.path[res.pathIndex];
          if (!targetNode) return res;

          const dx = targetNode.lat - res.lat;
          const dy = targetNode.lng - res.lng;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const speed = 0.0001;

          if (dist < speed) {
            const nextIndex = res.pathIndex + 1;
            if (nextIndex >= res.path.length) {
              return { ...res, status: 'BUSY', path: [], justArrived: true };
            }
            return { ...res, lat: targetNode.lat, lng: targetNode.lng, pathIndex: nextIndex };
          } else {
            const ratio = speed / dist;
            return { ...res, lat: res.lat + dx * ratio, lng: res.lng + dy * ratio };
          }
        }
        return res;
      }));
    }, 100);

    return () => clearInterval(moveInterval);
  }, []);

  const handleReportSubmit = async (reportData) => {
    const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/report_incident`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportData)
    });

    if (!res.ok) {
      let errorMessage = 'Failed to submit incident report.';
      try {
        const errPayload = await res.json();
        if (errPayload?.error) {
          errorMessage = errPayload.error;
        }
      } catch (_) {}
      throw new Error(errorMessage);
    }

    const payload = await res.json();
    if (payload?.incident) {
      setSosData(prev => [payload.incident, ...prev]);
      setSelectedIncident(payload.incident);
    }
  };

  const handlePanicAlert = async () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by this browser.');
      return;
    }

    setPanicSubmitting(true);

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const payload = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        venue_name: 'Hospitality Venue',
        floor: 'Unknown',
        room_or_zone: 'Panic Trigger Zone',
        reporter_type: 'Staff',
        affected_people_count: 1,
        panic_code: 'PANIC-01',
        description: 'Silent panic button triggered. Dispatch nearest responders immediately.'
      };

      const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/panic_alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let errorMessage = 'Failed to trigger panic alert.';
        try {
          const errPayload = await res.json();
          if (errPayload?.error) {
            errorMessage = errPayload.error;
          }
        } catch (_) {}
        throw new Error(errorMessage);
      }

      const responsePayload = await res.json();
      if (responsePayload?.incident) {
        setSosData(prev => [responsePayload.incident, ...prev]);
        setSelectedIncident(responsePayload.incident);
      }
    } catch (err) {
      console.error('Panic alert failed:', err);
      alert(err.message || 'Failed to trigger panic alert.');
    } finally {
      setPanicSubmitting(false);
    }
  };

  const mumbaiCenter = { lat: 19.0760, lng: 72.8777 };

  useEffect(() => {
    setKpis(calculateResponseKpis(sosData));
    sosData.forEach(i => knownIdsRef.current.add(i.id));
  }, [sosData]);

  const dismissNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const focusNotification = useCallback((incident) => {
    setSelectedIncident(incident);
    setNotifications(prev => prev.filter(n => n.id !== incident.id));
  }, []);

  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setTimeout(() => {
      setNotifications(prev => prev.slice(0, -1));
    }, 8000);
    return () => clearTimeout(timer);
  }, [notifications]);

  const allCategories = [...new Set(sosData.map(i => i.category).filter(Boolean))];

  const filteredSosData = sosData.filter(item => {
    if (filterCategory !== 'All' && item.category !== filterCategory) return false;
    if (filterPriority !== 'All' && item.priority !== filterPriority) return false;
    if (filterStatus !== 'All' && item.status !== filterStatus) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      const searchable = `${item.original_message} ${item.venue_name} ${item.location_text || item.location} ${item.category}`.toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });

  useEffect(() => {
    const arrivals = resources.filter(res => res.justArrived && res.target_incident_id);
    if (arrivals.length === 0) return;

    const arrivedResourceIds = new Set(arrivals.map(res => res.id));
    setResources(prev => prev.map(res => {
      if (!arrivedResourceIds.has(res.id)) return res;
      return { ...res, justArrived: false };
    }));

    arrivals.forEach((res) => {
      updateIncidentStatus(res.target_incident_id, 'On Scene', {
        actor: 'system',
        note: `${res.name} reached destination`
      }).catch((err) => {
        console.error('Failed to persist On Scene update:', err);
      });
    });
  }, [resources, updateIncidentStatus]);

  // Command palette action handler
  const handleCommandAction = useCallback((action) => {
    if (action === 'report') setShowReportModal(true);
    else if (action === 'analytics') setShowAnalytics(prev => !prev);
    else if (action === 'copilot') setShowCopilot(true);
  }, []);

  // Incident count for sidebar
  const activeCount = sosData.filter(i => i.status !== 'Resolved').length;
  const criticalCount = sosData.filter(i => i.priority === 'Critical' && i.status !== 'Resolved').length;

  return (
    <APIProvider apiKey={process.env.REACT_APP_GOOGLE_MAPS_API_KEY}>
      <AnimatePresence>
        {showIntro && <IntroOverlay onComplete={handleIntroComplete} />}
      </AnimatePresence>

      <div className="app-container">
        {/* ESCALATION BANNERS */}
        <EscalationBanner
          incidents={sosData}
          resources={resources}
          onDismiss={(id) => setDismissedEscalations(prev => new Set([...prev, id]))}
        />

        {/* HEADER */}
        <header className="app-header glass" role="banner">
          <div className="logo-area">
            <Activity className="pulse-icon" aria-hidden="true" />
            <h1>MUMBAI DISASTER RESPONSE</h1>
            <span className="version-badge">v3.0</span>
          </div>

          <div className="header-stats">
            <DigitalClock />
            <ConnectionStatus connected={connected} />
            <ResourceCapacityBar resources={resources} />
          </div>

          <div className="header-actions">
            <button
              className="cmd-trigger-btn"
              onClick={() => setShowCommandPalette(true)}
              title="Command Palette (Ctrl+K)"
              aria-label="Open command palette"
            >
              <Command size={14} />
              <span className="cmd-key-hint">Ctrl+K</span>
            </button>
            <button
              className={`copilot-toggle-btn ${showCopilot ? 'active' : ''}`}
              onClick={() => setShowCopilot(!showCopilot)}
              title="AI Copilot"
              aria-label="Toggle AI Copilot"
            >
              <Bot size={16} />
              AI
            </button>
            <button
              className={`analytics-toggle-btn ${showAnalytics ? 'active' : ''}`}
              onClick={() => setShowAnalytics(!showAnalytics)}
              title={showAnalytics ? 'Show Map' : 'Show Analytics'}
              aria-label={showAnalytics ? 'Switch to map view' : 'Switch to analytics view'}
            >
              {showAnalytics ? <><MapIcon size={16} /> MAP</> : <><BarChart3 size={16} /> ANALYTICS</>}
            </button>
            <div className={`bridge-badge ${bridgeMode.mode === 'live' ? 'live' : 'mock'}`}>
              BRIDGE: {bridgeMode.mode === 'live' ? 'LIVE' : bridgeMode.mode === 'mock' ? 'MOCK' : 'UNKNOWN'}
            </div>
            <button className="report-btn-header" onClick={() => setShowReportModal(true)} aria-label="Report new incident">
              <AlertTriangle size={18} aria-hidden="true" />
              REPORT INCIDENT
            </button>
            <button className="panic-btn-header" onClick={handlePanicAlert} disabled={panicSubmitting} aria-label="Trigger panic alert">
              <AlertCircle size={18} aria-hidden="true" />
              {panicSubmitting ? 'TRIGGERING...' : 'PANIC BUTTON'}
            </button>
            <FleetDropdown resources={resources} onSelect={(res) => { setSelectedVehicle(res); setSelectedIncident(null); }} />
          </div>
        </header>

        <div className="main-content" role="main">
          {/* SIDEBAR */}
          <div className="sidebar left-sidebar glass" role="complementary" aria-label="Incident sidebar">
            {/* --- WEATHER CARD --- */}
            <div className="weather-card">
              <div className="weather-header">
                <h3><span className="live-dot" aria-hidden="true"></span> MUMBAI LIVE</h3>
                <span>{situation.temp}</span>
              </div>
              <div className="weather-details">
                <span className="weather-cond">{situation.cond}</span>
                <p className="weather-insight">"{situation.insight}"</p>
              </div>
            </div>

            <div className="kpi-strip">
              <div className="kpi-item">
                <span className="kpi-label">Avg Ack</span>
                <span className="kpi-value">{formatDuration(kpis.avgAcknowledgeMins)}</span>
              </div>
              <div className="kpi-item">
                <span className="kpi-label">Avg Dispatch</span>
                <span className="kpi-value">{formatDuration(kpis.avgDispatchMins)}</span>
              </div>
              <div className="kpi-item">
                <span className="kpi-label">Avg Resolve</span>
                <span className="kpi-value">{formatDuration(kpis.avgResolveMins)}</span>
              </div>
              <div className="kpi-item alert">
                <span className="kpi-label">Critical Open</span>
                <span className="kpi-value">{kpis.unresolvedCritical}</span>
              </div>
            </div>

            <div className="bridge-log-card">
              <div className="bridge-log-header">
                <h3>Bridge Activity</h3>
                <span className={`bridge-log-mode ${bridgeMode.mode === 'live' ? 'live' : 'mock'}`}>
                  {bridgeMode.mode === 'live' ? 'Live Relay' : 'Mock Relay'}
                </span>
              </div>
              <div className="bridge-log-list">
                {bridgeEvents.length === 0 ? (
                  <p className="bridge-log-empty">No bridge events yet. Critical incidents and lifecycle updates will appear here.</p>
                ) : bridgeEvents.map((event) => (
                  <div key={event.id} className="bridge-log-item">
                    <div className="bridge-log-row">
                      <span className="bridge-log-title">{formatBridgeEventLabel(event.event_type)}</span>
                      <span className={`bridge-log-status ${event.delivery_status}`}>{event.delivery_status}</span>
                    </div>
                    <p className="bridge-log-summary">
                      #{event.incident?.id} {event.incident?.category || 'Incident'} at {event.incident?.venue_name || 'Unknown Venue'}
                    </p>
                    <div className="bridge-log-meta">
                      <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                      <span>{event.incident?.status || 'Unknown status'}</span>
                      <span>{event.delivery_mode === 'webhook' ? 'Webhook' : 'Mock'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* FEED HEADER WITH COUNTS */}
            <div className="feed-header">
              <h2>Live SOS Feed</h2>
              <div className="feed-counts">
                <span className="feed-count-badge active">{activeCount} active</span>
                {criticalCount > 0 && <span className="feed-count-badge critical">{criticalCount} critical</span>}
              </div>
            </div>

            {/* --- FILTER BAR --- */}
            <div className="filter-bar">
              <div className="filter-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search incidents..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  aria-label="Search incidents"
                />
              </div>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} aria-label="Filter by category">
                <option value="All">All Categories</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} aria-label="Filter by priority">
                <option value="All">All Priorities</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Moderate">Moderate</option>
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Filter by status">
                <option value="All">All Statuses</option>
                <option value="Created">Created</option>
                <option value="Acknowledged">Acknowledged</option>
                <option value="Dispatched">Dispatched</option>
                <option value="En Route">En Route</option>
                <option value="On Scene">On Scene</option>
                <option value="Resolved">Resolved</option>
              </select>
            </div>

            <div className="sos-feed" role="feed" aria-label="Incident feed">
              {loading ? <p>Loading data...</p> : filteredSosData.length === 0 ? (
                <p className="no-incidents">No incidents match your filters.</p>
              ) : filteredSosData.map(item => (
                <motion.div
                  key={item.id}
                  className={`sos-card priority-${item.priority.toLowerCase()} ${selectedIncident?.id === item.id ? 'active' : ''}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => setSelectedIncident(item)}
                  role="article"
                  aria-label={`${item.priority} incident: ${item.category}`}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelectedIncident(item); }}
                >
                  <div className="sos-header">
                    <span className={`category-badge ${item.urgency ? item.urgency.toLowerCase() : 'minor'}`}>{item.category}</span>
                    <span className="time">{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="sos-msg">{item.original_message}</p>
                  <p className="helper-text">
                    {item.venue_name || 'Unknown Venue'} | {item.floor || 'Unknown'} | {item.room_or_zone || 'Unknown'}
                  </p>
                  <div className="incident-source-row">
                    <span className={`incident-source ${item.source || 'external_feed'}`}>{formatIncidentSource(item.source)}</span>
                    {item.panic_code && <span className="incident-source panic-code">{item.panic_code}</span>}
                  </div>
                  <div className="sos-meta">
                    <span><MapPin size={12} aria-hidden="true" /> {item.location_text || item.location}</span>
                    <div className="severity-bar">
                      <div className="fill" style={{
                        width: `${item.severity_score * 10}%`,
                        backgroundColor: item.severity_score > 7 ? '#ef4444' : item.severity_score > 4 ? '#f59e0b' : '#10b981'
                      }}></div>
                    </div>
                  </div>
                  {item.assigned_vehicle && <div className="assigned-badge"><Truck size={12} aria-hidden="true" /> Unit Dispatched</div>}
                </motion.div>
              ))}
            </div>
          </div>

          {/* MAP AREA or ANALYTICS */}
          {showAnalytics ? (
            <div className="analytics-wrapper">
              <AnalyticsDashboard />
            </div>
          ) : (
          <div className="map-wrapper">
            <GoogleMap
              defaultCenter={mumbaiCenter}
              defaultZoom={12}
              mapId="4f65c879d6c34275"
              disableDefaultUI={true}
              className="google-map"
            >
              <MapControls showTraffic={showTraffic} setShowTraffic={setShowTraffic} />

              {/* Incident Markers */}
              {sosData.map(incident => (
                <AdvancedMarker
                  key={incident.id}
                  position={incident.coordinates}
                  onClick={() => setSelectedIncident(incident)}
                >
                  <div className={`custom-marker ${incident.priority.toLowerCase()} ${selectedIncident?.id === incident.id ? 'selected' : ''} ${incident.severity_score >= 8 ? 'pulse-critical' : ''}`}>
                    <AlertCircle size={20} color="white" />
                  </div>
                </AdvancedMarker>
              ))}

              {/* Resource Markers */}
              {resources.map(res => (
                <AdvancedMarker
                  key={res.id}
                  position={{ lat: res.lat, lng: res.lng }}
                  onClick={() => setSelectedVehicle(res)}
                >
                  <div className={`resource-marker ${res.type} ${res.status.toLowerCase()}`}>
                    {res.type === 'ambulance' && <Activity size={16} color="white" />}
                    {res.type === 'police' && <Shield size={16} color="white" />}
                    {res.type === 'fire' && <Flame size={16} color="white" />}
                  </div>
                </AdvancedMarker>
              ))}

              {/* Route Polyline */}
              {resources.map(res => (
                res.status === 'DISPATCHED' && res.path && (
                  <RoutePolyline
                    key={res.id}
                    path={res.path}
                  />
                )
              ))}
            </GoogleMap>
          </div>
          )}
        </div>

        {/* NOTIFICATIONS */}
        <NotificationToast
          notifications={notifications}
          onDismiss={dismissNotification}
          onFocus={focusNotification}
        />

        {/* Hidden audio element for alert sounds */}
        <audio ref={alertAudioRef} preload="auto">
          <source src="data:audio/wav;base64,UklGRiQDAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQADAAB/f39/f39/f4B/gH+Af4B/f39/f39/f39/f39/f39/gH+Af4B/gH9/f39/f39/f39/eH94f3h/eH94f3h/d393f3d/d393f3d/d393f3Z/dn92f3Z/dn92f3V/dX91f3V/dX91f3R/dH90f3R/dH90f3N/c39zf3N/c39zf3J/cn9yf3J/cn9yf3F/cX9xf3F/cX9xf3B/cH9wf3B/cH9wf29/b39vf29/b39vf25/bn9uf21/bX9tf2x/bH9sf2t/a39rf2p/a39rf2x/bH9sf21/bX9tf25/bn9uf29/b39vf3B/cH9wf3F/cX9xf3J/cn9yf3N/c39zf3R/dH90f3V/dX91f3Z/dn92f3d/d393f3h/eH94f3l/eX95f3p/en96f3t/e397f3x/fH98f31/fX99f35/fn9+f39/f39/f4B/gH+Af4F/gX+Bf4J/gn+Cf4N/g3+Df4R/hH+Ef4V/hX+Ff4Z/hn+Gf4d/h3+Hf4h/iH+If4l/iX+Jf4p/in+Kf4t/i3+Lf4x/jH+Mf41/jX+Nf45/jn+Of49/j3+Pf5B/kH+Qf5F/kX+Rf5J/kn+Sf5N/k3+Tf5R/lH+Uf5V/lX+Vf5Z/ln+Wf5d/l3+Xf5h/mH+Yf5l/mX+Zf5p/mn+af5t/m3+bf5x/nH+cf5x/nH+cf5t/m3+bf5p/mn+af5l/mX+Zf5h/mH+Yf5d/l3+Xf5Z/ln+Wf5V/lX+Vf5R/lH+Uf5N/k3+Tf5J/kn+Sf5F/kX+Rf5B/kH+Qf49/j3+Pf45/jn+Of41/jX+Nf4x/jH+Mf4t/i3+Lf4p/in+Kf4l/iX+Jf4h/iH+If4d/h3+Hf4Z/hn+Gf4V/hX+Ff4R/hH+Ef4N/g3+Df4J/gn+Cf4F/gX+Bf4B/gH+Af39/f39/f35/fn9+f31/fX99f3x/fH98f3t/e397f3p/en96f3l/eX95f3h/eH94f3d/d393f3Z/dn92f3V/dX91f3R/dH90f3N/c39zf3J/cn9yf3F/cX9x" type="audio/wav" />
        </audio>

        {/* MODALS & PANELS */}
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          onSubmit={handleReportSubmit}
        />
        <VehicleDetailPanel
          vehicle={selectedVehicle}
          onClose={() => setSelectedVehicle(null)}
          onAssign={assignVehicle}
          incidents={sosData}
        />
        <IncidentDetailPanel
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onAssign={assignVehicle}
          onStatusChange={handleIncidentStatusChange}
          vehicles={resources}
        />

        {/* AI COPILOT */}
        <AnimatePresence>
          {showCopilot && (
            <AICopilot
              isOpen={showCopilot}
              onClose={() => setShowCopilot(false)}
            />
          )}
        </AnimatePresence>

        {/* COMMAND PALETTE */}
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          incidents={sosData}
          vehicles={resources}
          onSelectIncident={(inc) => { setSelectedIncident(inc); setSelectedVehicle(null); }}
          onSelectVehicle={(v) => { setSelectedVehicle(v); setSelectedIncident(null); }}
          onAction={handleCommandAction}
        />
      </div>
    </APIProvider>
  );
}

export default App;
