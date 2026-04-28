import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, MapPin, Clock, Truck, Shield, Activity, X, Navigation, MessageSquare, Send, Zap, ShieldAlert, Users, Building } from 'lucide-react';
import './App.css';

export default function IncidentDetailPanel({ incident, onClose, onAssign, onStatusChange, vehicles }) {
    const sortedVehicles = useMemo(() => {
        if (!vehicles || !incident) return [];
        return [...vehicles].sort((a, b) => {
            const distA = Math.hypot(a.lat - incident.coordinates.lat, a.lng - incident.coordinates.lng);
            const distB = Math.hypot(b.lat - incident.coordinates.lat, b.lng - incident.coordinates.lng);
            return distA - distB;
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

    const statusColors = {
        'Created': '#64748b',
        'Acknowledged': '#3b82f6',
        'Dispatched': '#8b5cf6',
        'En Route': '#f59e0b',
        'On Scene': '#06b6d4',
        'Resolved': '#10b981',
    };

    return (
        <motion.div
            className="sidebar right-sidebar glass"
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{ borderLeft: `4px solid ${color}` }}
            role="complementary"
            aria-label="Incident detail panel"
        >
            <div className="sidebar-header">
                <h2>
                    <AlertTriangle color={color} className="icon-pulse" aria-hidden="true" />
                    Incident Command
                </h2>
                <button className="close-btn" onClick={onClose} aria-label="Close panel"><X size={20} /></button>
            </div>

            <div className="details-content">
                <div className="incident-hero" style={{ borderColor: color }}>
                    <div className="hero-top-row">
                        <span className="category-badge" style={{ backgroundColor: color + '33', color: color, border: `1px solid ${color}` }}>
                            {incident.category}
                        </span>
                        <span className="status-badge" style={{ backgroundColor: (statusColors[incident.status] || '#64748b') + '33', color: statusColors[incident.status] || '#64748b' }}>
                            {incident.status || 'Created'}
                        </span>
                    </div>
                    <h3>{incident.original_message}</h3>
                    <div className="hero-meta">
                        <span><Clock size={14} aria-hidden="true" /> {new Date(incident.timestamp).toLocaleTimeString()}</span>
                        <span>Severity: <strong>{incident.severity_score}/10</strong></span>
                        <span><Users size={14} aria-hidden="true" /> {incident.affected_people_count || 1} affected</span>
                    </div>

                    {/* Severity visual bar */}
                    <div className="hero-severity-bar">
                        <div className="hero-severity-fill" style={{ width: `${incident.severity_score * 10}%`, backgroundColor: color }} />
                        <div className="hero-severity-labels">
                            <span>LOW</span>
                            <span>CRITICAL</span>
                        </div>
                    </div>
                </div>

                {/* AI Triage Section */}
                <TriageSection incidentId={incident.id} />

                <section className="detail-section">
                    <h3><Clock size={16} aria-hidden="true" /> Lifecycle Actions</h3>
                    <div className="incident-override-list">
                        {statusOptions.map(status => (
                            <button
                                key={status}
                                className="override-btn"
                                disabled={incident.status === status}
                                onClick={() => onStatusChange(incident.id, status)}
                                aria-label={`Set status to ${status}`}
                            >
                                <span className="override-dot" style={{ backgroundColor: statusColors[status] || '#64748b' }} />
                                Set Status: {status}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="detail-section">
                    <h3><MapPin size={16} aria-hidden="true" /> Location</h3>
                    <p className="location-text-large">{incident.location_text || incident.location}</p>
                    <p className="coords-text">
                        LAT: {incident.coordinates.lat.toFixed(4)} | LNG: {incident.coordinates.lng.toFixed(4)}
                    </p>
                </section>

                <section className="detail-section">
                    <h3><Building size={16} aria-hidden="true" /> Hospitality Context</h3>
                    <div className="context-grid">
                        <div className="context-item">
                            <span className="context-label">Venue</span>
                            <span className="context-value">{incident.venue_name || 'Unknown Venue'}</span>
                        </div>
                        <div className="context-item">
                            <span className="context-label">Floor</span>
                            <span className="context-value">{incident.floor || 'Unknown'}</span>
                        </div>
                        <div className="context-item">
                            <span className="context-label">Zone</span>
                            <span className="context-value">{incident.room_or_zone || 'Unknown'}</span>
                        </div>
                        <div className="context-item">
                            <span className="context-label">Reporter</span>
                            <span className="context-value">{incident.reporter_type || 'Guest'}</span>
                        </div>
                    </div>
                </section>

                <section className="detail-section">
                    <h3><Truck size={16} aria-hidden="true" /> Dispatch Units</h3>
                    <p className="helper-text">Select nearest available unit:</p>

                    <div className="vehicle-dispatch-list">
                        {sortedVehicles.map(vehicle => {
                            const isAvailable = vehicle.status === 'IDLE';
                            const dist = Math.hypot(vehicle.lat - incident.coordinates.lat, vehicle.lng - incident.coordinates.lng) * 111;

                            return (
                                <button
                                    key={vehicle.id}
                                    className={`dispatch-btn ${isAvailable ? 'available' : 'busy'}`}
                                    disabled={!isAvailable}
                                    onClick={() => onAssign(vehicle.id, incident.id)}
                                    aria-label={`Dispatch ${vehicle.name}`}
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

                {/* Visual Timeline */}
                <section className="detail-section">
                    <h3><Clock size={16} aria-hidden="true" /> Status Timeline</h3>
                    <div className="visual-timeline">
                        {timeline.slice(0, 8).map((entry, index) => (
                            <div key={`${entry.timestamp}-${index}`} className="timeline-node">
                                <div className="timeline-connector">
                                    <div className="timeline-dot" style={{ backgroundColor: statusColors[entry.status] || '#64748b' }} />
                                    {index < timeline.length - 1 && <div className="timeline-line" />}
                                </div>
                                <div className="timeline-content">
                                    <div className="timeline-top-row">
                                        <span className="timeline-status" style={{ color: statusColors[entry.status] || '#64748b' }}>{entry.status}</span>
                                        <span className="timeline-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                    <span className="timeline-note">{entry.actor || 'system'}{entry.note ? ` — ${entry.note}` : ''}</span>
                                </div>
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


function TriageSection({ incidentId }) {
    const [triage, setTriage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    const fetchTriage = useCallback(async () => {
        setLoading(true);
        setError(false);
        try {
            const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/ai_triage/${incidentId}`);
            if (res.ok) {
                const data = await res.json();
                setTriage(data);
            } else {
                setError(true);
            }
        } catch (_) {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [incidentId]);

    useEffect(() => {
        fetchTriage();
    }, [fetchTriage]);

    const riskColors = {
        extreme: '#ef4444',
        high: '#f59e0b',
        moderate: '#3b82f6',
        low: '#10b981',
    };

    return (
        <section className="detail-section triage-section">
            <h3><Zap size={16} aria-hidden="true" /> AI Triage Plan</h3>
            {loading && <div className="triage-loading"><div className="loader small" /> Analyzing...</div>}
            {error && <p className="triage-error">Unable to generate triage plan.</p>}
            {triage && (
                <div className="triage-content">
                    <div className="triage-header-row">
                        <span className="triage-risk" style={{ color: riskColors[triage.risk_level] || '#64748b', borderColor: riskColors[triage.risk_level] || '#64748b' }}>
                            <ShieldAlert size={14} /> {(triage.risk_level || 'unknown').toUpperCase()} RISK
                        </span>
                        {triage.evacuation_needed && (
                            <span className="triage-evac">⚠ EVACUATION NEEDED</span>
                        )}
                    </div>

                    {triage.estimated_response_time && (
                        <div className="triage-eta">
                            <Clock size={13} /> ETA: {triage.estimated_response_time}
                        </div>
                    )}

                    {triage.immediate_actions && triage.immediate_actions.length > 0 && (
                        <div className="triage-block">
                            <span className="triage-block-label">Immediate Actions</span>
                            {triage.immediate_actions.map((a, i) => (
                                <div key={i} className="triage-action-item">
                                    <span className="triage-num">{i + 1}</span>
                                    {a}
                                </div>
                            ))}
                        </div>
                    )}

                    {triage.resources_needed && triage.resources_needed.length > 0 && (
                        <div className="triage-block">
                            <span className="triage-block-label">Resources Required</span>
                            <div className="triage-resources">
                                {triage.resources_needed.map((r, i) => (
                                    <span key={i} className="triage-resource-tag">{r}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {triage.special_considerations && triage.special_considerations.length > 0 && (
                        <div className="triage-block">
                            <span className="triage-block-label">⚠ Special Considerations</span>
                            {triage.special_considerations.map((s, i) => (
                                <p key={i} className="triage-consideration">{s}</p>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}


function CommLogSection({ incidentId }) {
    const [notes, setNotes] = useState([]);
    const [newMsg, setNewMsg] = useState('');
    const [sending, setSending] = useState(false);

    const fetchNotes = useCallback(async () => {
        try {
            const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/incident_notes/${incidentId}`);
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
            const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://127.0.0.1:5001'}/incident_notes`, {
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
            <h3><MessageSquare size={16} aria-hidden="true" /> Communication Log</h3>
            <div className="comm-input-row">
                <input
                    type="text"
                    placeholder="Add a note..."
                    value={newMsg}
                    onChange={(e) => setNewMsg(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                    disabled={sending}
                    aria-label="Communication log input"
                />
                <button className="comm-send-btn" onClick={handleSend} disabled={sending || !newMsg.trim()} aria-label="Send note">
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
