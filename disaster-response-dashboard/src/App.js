import React, { useState, useEffect, useRef } from 'react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, useMap } from '@vis.gl/react-google-maps';
import { decode } from '@googlemaps/polyline-codec';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, MapPin, Navigation, Activity, Shield, Flame, Truck, AlertTriangle } from 'lucide-react';
import ReportModal from './ReportModal';
import VehicleDetailPanel from './VehicleDetailPanel';
import IncidentDetailPanel from './IncidentDetailPanel';
import FleetDropdown from './FleetDropdown';
import { findPath } from './MumbaiNavigationGraph';
import IntroOverlay from './IntroOverlay';
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
        strokeColor: '#3b82f6', // Modern blue
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
    <div className="digital-clock">
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

// --- MAIN APP COMPONENT ---
function App() {
  const [showIntro, setShowIntro] = useState(false); // Disabled by user request
  const [sosData, setSosData] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [decodedPath, setDecodedPath] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nearbyPlaces, setNearbyPlaces] = useState({ hospitals: [], police_stations: [], fire_stations: [] });
  const [showTraffic, setShowTraffic] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [error, setError] = useState(null);
  const [situation, setSituation] = useState({ temp: "--", cond: "Loading...", insight: "Connecting to AI satellite..." });
  const [bridgeMode, setBridgeMode] = useState({ mode: 'unknown', webhook_configured: false });
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

  useEffect(() => {
    const fetchSituation = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5001/get_situation_update');
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
        const res = await fetch('http://127.0.0.1:5001/bridge_status');
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
        const res = await fetch('http://127.0.0.1:5001/get_sos_data');
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

        setError(null);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching SOS data:", err);
        setError("Could not load disaster data. Is the backend running?");
        setLoading(false);
      }
    };

    fetchSituation();
    fetchSos();
    fetchBridgeStatus();

    const sosInterval = setInterval(fetchSos, 5000);
    const situationInterval = setInterval(fetchSituation, 60000);
    const bridgeStatusInterval = setInterval(fetchBridgeStatus, 60000);

    return () => {
      clearInterval(sosInterval);
      clearInterval(situationInterval);
      clearInterval(bridgeStatusInterval);
    };
  }, []);

  // Helper: Fetch Route in Background
  const fetchRouteForVehicle = async (vehicle, target) => {
    try {
      const res = await fetch(`http://127.0.0.1:5001/get_route?lat=${target.coordinates.lat}&lng=${target.coordinates.lng}&start_lat=${vehicle.lat}&start_lng=${vehicle.lng}`);
      if (res.ok) {
        const data = await res.json();
        if (data.overview_polyline) {
          const decoded = decode(data.overview_polyline);
          const newPath = decoded.map(([lat, lng]) => ({ lat, lng }));

          // Update vehicle with path once loaded
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
      // Fallback path (straight line) already handled if path is empty
      setResources(prev => prev.map(r => {
        if (r.id === vehicle.id) {
          return { ...r, path: [{ lat: vehicle.lat, lng: vehicle.lng }, target.coordinates] };
        }
        return r;
      }));
    }
  };

  const updateIncidentStatus = async (incidentId, status, options = {}) => {
    const payload = {
      incident_id: incidentId,
      status,
      actor: options.actor || 'operator',
      note: options.note || `Status changed to ${status}`
    };

    if (options.assigned_vehicle !== undefined) {
      payload.assigned_vehicle = options.assigned_vehicle;
    }

    const res = await fetch('http://127.0.0.1:5001/update_incident_status', {
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
      } catch (_) {
        // Keep fallback error message.
      }
      throw new Error(errorMessage);
    }

    const responsePayload = await res.json();
    if (responsePayload?.incident) {
      setSosData(prev => prev.map(inc => inc.id === responsePayload.incident.id ? responsePayload.incident : inc));
      setSelectedIncident(prev => prev && prev.id === responsePayload.incident.id ? responsePayload.incident : prev);
    }
  };

  const assignVehicle = async (vehicleId, incidentId) => {
    const vehicle = resources.find(r => r.id === vehicleId);
    if (!vehicle) return;

    // 1. Optimistic Update (Instant Feedback)
    setResources(prev => prev.map(res => {
      if (res.id === vehicleId) {
        return {
          ...res,
          status: incidentId ? 'DISPATCHED' : 'IDLE',
          target_incident_id: incidentId,
          path: [], // Reset path until loaded
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

      // 2. Trigger Route Fetch
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
  };

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
  }, [sosData]);

  // SIMULATE MOVEMENT (Following Path)
  useEffect(() => {
    const moveInterval = setInterval(() => {
      setResources(prev => prev.map(res => {
        if (res.status === 'DISPATCHED' && res.path && res.path.length > 0) {
          const targetNode = res.path[res.pathIndex];
          if (!targetNode) return res;

          const dx = targetNode.lat - res.lat;
          const dy = targetNode.lng - res.lng;
          const dist = Math.sqrt(dx * dx + dy * dy);

          const speed = 0.0001; // Realistic speed

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
    const res = await fetch('http://127.0.0.1:5001/report_incident', {
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
      } catch (_) {
        // Keep default error message when response is non-JSON.
      }
      throw new Error(errorMessage);
    }

    const payload = await res.json();
    if (payload?.incident) {
      setSosData(prev => [payload.incident, ...prev]);
      setSelectedIncident(payload.incident);
    }
  };

  const mumbaiCenter = { lat: 19.0760, lng: 72.8777 };

  useEffect(() => {
    setKpis(calculateResponseKpis(sosData));
  }, [sosData]);

  useEffect(() => {
    const arrivals = resources.filter(res => res.justArrived && res.target_incident_id);
    if (arrivals.length === 0) {
      return;
    }

    const arrivedResourceIds = new Set(arrivals.map(res => res.id));
    setResources(prev => prev.map(res => {
      if (!arrivedResourceIds.has(res.id)) {
        return res;
      }
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
  }, [resources]);

  return (
    <APIProvider apiKey={process.env.REACT_APP_GOOGLE_MAPS_API_KEY}>
      <AnimatePresence>
        {showIntro && <IntroOverlay onComplete={handleIntroComplete} />}
      </AnimatePresence>

      <div className="app-container">
        {/* HEADER */}
        <header className="app-header glass">
          <div className="logo-area">
            <Activity className="pulse-icon" />
            <h1>MUMBAI DISASTER RESPONSE</h1>
          </div>

          <div className="header-stats">
            <DigitalClock />
            <div className="stat-item pulse-stat">
              <span className="stat-label">LIVE STATUS</span>
              <span className="stat-value text-green">ONLINE</span>
            </div>
          </div>

          <div className="header-actions">
            <div className={`bridge-badge ${bridgeMode.mode === 'live' ? 'live' : 'mock'}`}>
              BRIDGE: {bridgeMode.mode === 'live' ? 'LIVE' : bridgeMode.mode === 'mock' ? 'MOCK' : 'UNKNOWN'}
            </div>
            <button className="report-btn-header" onClick={() => setShowReportModal(true)}>
              <AlertTriangle size={18} />
              REPORT INCIDENT
            </button>
            <FleetDropdown resources={resources} onSelect={(res) => { setSelectedVehicle(res); setSelectedIncident(null); }} />
          </div>
        </header>

        <div className="main-content">
          {/* SIDEBAR */}
          <div className="sidebar left-sidebar glass">
            {/* --- WEATHER CARD --- */}
            <div className="weather-card">
              <div className="weather-header">
                <h3><span className="live-dot"></span> MUMBAI LIVE</h3>
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

            <h2>Live SOS Feed</h2>
            <div className="sos-feed">
              {loading ? <p>Loading data...</p> : sosData.map(item => (
                <motion.div
                  key={item.id}
                  className={`sos-card priority-${item.priority.toLowerCase()}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => setSelectedIncident(item)}
                >
                  <div className="sos-header">
                    <span className={`category-badge ${item.urgency ? item.urgency.toLowerCase() : 'minor'}`}>{item.category}</span>
                    <span className="time">{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="sos-msg">{item.original_message}</p>
                  <p className="helper-text">
                    {item.venue_name || 'Unknown Venue'} | {item.floor || 'Unknown'} | {item.room_or_zone || 'Unknown'}
                  </p>
                  <div className="sos-meta">
                    <span><MapPin size={12} /> {item.location_text || item.location}</span>
                    <div className="severity-bar">
                      <div className="fill" style={{
                        width: `${item.severity_score * 10}%`,
                        backgroundColor: item.severity_score > 7 ? '#ef4444' : item.severity_score > 4 ? '#f59e0b' : '#10b981'
                      }}></div>
                    </div>
                  </div>
                  {item.assigned_vehicle && <div className="assigned-badge"><Truck size={12} /> Unit Dispatched</div>}
                </motion.div>
              ))}
            </div>
          </div>

          {/* MAP AREA */}
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
                  <div className={`custom-marker ${incident.priority.toLowerCase()} ${selectedIncident?.id === incident.id ? 'selected' : ''}`}>
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
                    path={res.path.map(p => [p.lat, p.lng])}
                  />
                )
              ))}
            </GoogleMap>
          </div>
        </div>

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
      </div>
    </APIProvider>
  );
}

export default App;