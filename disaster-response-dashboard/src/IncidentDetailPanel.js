import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, MapPin, Clock, Truck, Shield, Activity, X, Navigation, MessageSquare, Send } from 'lucide-react';
import './App.css';

export default function IncidentDetailPanel({ incident, onClose, onAssign, onStatusChange, vehicles }) {
    // Calculate distances and sort vehicles (Simple Euclidean for now)
    const sortedVehicles = useMemo(() => {
        if (!vehicles || !incident) return [];
        return [...vehicles].sort((a, b) => {
            const distA = Math.hypot(a.lat - incident.coordinates.lat, a.lng - incident.coordinates.lng);
            const distB = Math.hypot(b.lat - incident.coordinates.lat, b.lng - incident.coordinates.lng);
            return distA - distB; // Closest first
        });
    }, [incident, vehicles]);

    if (!incident) return null;

    const getSeverityColor = (score) => {
        if (score > 7) return '#ef4444';
        if (score > 4) return '#f59e0b';
        return '#10b981';
    };

    const color = getSeverityColor(incident.severity_score);
    const statusOptions = ['Acknowledged', 'En Route', 'On Scene', 'Resolved'];
    const timeline = Array.isArray(incident.status_timeline) ? [...incident.status_timeline].reverse() : [];

    return (
        <motion.div
            className="sidebar right-sidebar glass"
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{ borderLeft: `4px solid ${color}` }}
        >
            <div className="sidebar-header">
                <h2>
                    <AlertTriangle color={color} className="icon-pulse" />
                    Incident Command
                </h2>
                <button className="close-btn" onClick={onClose}><X size={20} /></button>
            </div>

            <div className="details-content">
                <div className="incident-hero" style={{ borderColor: color }}>
                    <span className="category-badge" style={{ backgroundColor: color + '33', color: color, border: `1px solid ${color}` }}>
                        {incident.category}
                    </span>
                    <h3>{incident.original_message}</h3>
                    <div className="hero-meta">
                        <span><Clock size={14} /> {new Date(incident.timestamp).toLocaleTimeString()}</span>
                        <span>Severity: <strong>{incident.severity_score}/10</strong></span>
                        <span>Status: <strong>{incident.status || 'Created'}</strong></span>
                    </div>
                </div>

                <section className="detail-section">
                    <h3><Clock size={16} /> Lifecycle Actions</h3>
                    <div className="incident-override-list">
                        {statusOptions.map(status => (
                            <button
                                key={status}
                                className="override-btn"
                                disabled={incident.status === status}
                                onClick={() => onStatusChange(incident.id, status)}
                            >
                                Set Status: {status}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="detail-section">
                    <h3><MapPin size={16} /> Location</h3>
                    <p className="location-text-large">{incident.location_text || incident.location}</p>
                    <p className="coords-text">
                        LAT: {incident.coordinates.lat.toFixed(4)} | LNG: {incident.coordinates.lng.toFixed(4)}
                    </p>
                </section>

                <section className="detail-section">
                    <h3><Shield size={16} /> Hospitality Context</h3>
                    <p className="helper-text">Venue: <strong>{incident.venue_name || 'Unknown Venue'}</strong></p>
                    <p className="helper-text">Floor: <strong>{incident.floor || 'Unknown'}</strong></p>
                    <p className="helper-text">Room / Zone: <strong>{incident.room_or_zone || 'Unknown'}</strong></p>
                    <p className="helper-text">Reporter: <strong>{incident.reporter_type || 'Guest'}</strong></p>
                    <p className="helper-text">Affected People: <strong>{incident.affected_people_count || 1}</strong></p>
                </section>

                <section className="detail-section">
                    <h3><Truck size={16} /> Dispatch Rescue Units</h3>
                    <p className="helper-text">Select nearest available unit:</p>

                    <div className="vehicle-dispatch-list">
                        {sortedVehicles.map(vehicle => {
                            const isAvailable = vehicle.status === 'IDLE';
                            const dist = Math.hypot(vehicle.lat - incident.coordinates.lat, vehicle.lng - incident.coordinates.lng) * 111; // Approx km

                            return (
                                <button
                                    key={vehicle.id}
                                    className={`dispatch-btn ${isAvailable ? 'available' : 'busy'}`}
                                    disabled={!isAvailable}
                                    onClick={() => onAssign(vehicle.id, incident.id)}
                                >
                                    <div className="v-icon">
                                        {vehicle.type === 'ambulance' && <Activity size={18} color={isAvailable ? "#ef4444" : "#64748b"} />}
                                        {vehicle.type === 'police' && <Shield size={18} color={isAvailable ? "#3b82f6" : "#64748b"} />}
                                        {vehicle.type === 'fire' && <Truck size={18} color={isAvailable ? "#f97316" : "#64748b"} />}
                                    </div>
                                    <div className="v-info">
                                        <span className="v-name">{vehicle.name}</span>
                                        <span className="v-status">{vehicle.status} • {dist.toFixed(1)} km away</span>
                                    </div>
                                    {isAvailable && <Navigation size={16} className="dispatch-arrow" />}
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="detail-section">
                    <h3><Clock size={16} /> Status Timeline</h3>
                    <div className="incident-override-list">
                        {timeline.slice(0, 6).map((entry, index) => (
                            <div key={`${entry.timestamp}-${index}`} className="override-btn" style={{ cursor: 'default' }}>
                                <div className="btn-row">
                                    <span className="inc-summary">{entry.status}</span>
                                    <span className="btn-loc">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                </div>
                                <span className="btn-loc">{entry.actor || 'system'}{entry.note ? ` - ${entry.note}` : ''}</span>
                            </div>
                        ))}
                        {timeline.length === 0 && (
                            <p className="no-incidents">No timeline updates yet.</p>
                        )}
                    </div>
                </section>

                <CommLogSection incidentId={incident.id} />
            </div>
        </motion.div>
    );
}


function CommLogSection({ incidentId }) {
    const [notes, setNotes] = useState([]);
    const [newMsg, setNewMsg] = useState('');
    const [sending, setSending] = useState(false);

    const fetchNotes = useCallback(async () => {
        try {
            const res = await fetch(`http://127.0.0.1:5001/incident_notes/${incidentId}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) setNotes(data);
            }
        } catch (_) {}
    }, [incidentId]);

    useEffect(() => {
        fetchNotes();
        const interval = setInterval(fetchNotes, 6000);
        return () => clearInterval(interval);
    }, [fetchNotes]);

    const handleSend = async () => {
        const msg = newMsg.trim();
        if (!msg) return;
        setSending(true);
        try {
            const res = await fetch('http://127.0.0.1:5001/incident_notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ incident_id: incidentId, message: msg, author: 'operator' }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.note) setNotes(prev => [data.note, ...prev]);
                setNewMsg('');
            }
        } catch (err) {
            console.error('Failed to send note:', err);
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="detail-section">
            <h3><MessageSquare size={16} /> Communication Log</h3>
            <div className="comm-input-row">
                <input
                    type="text"
                    placeholder="Add a note..."
                    value={newMsg}
                    onChange={(e) => setNewMsg(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                    disabled={sending}
                />
                <button className="comm-send-btn" onClick={handleSend} disabled={sending || !newMsg.trim()}>
                    <Send size={14} />
                </button>
            </div>
            <div className="comm-log-list">
                {notes.length === 0 ? (
                    <p className="no-incidents">No notes yet. Add the first one above.</p>
                ) : notes.slice(0, 20).map((note) => (
                    <div key={note.id} className="comm-log-item">
                        <div className="comm-log-header">
                            <span className="comm-author">{note.author}</span>
                            <span className="comm-time">{new Date(note.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="comm-msg">{note.message}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}
