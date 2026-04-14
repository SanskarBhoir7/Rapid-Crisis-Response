import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, AlertCircle, Truck, MapPin, Zap } from 'lucide-react';
import './App.css';

export default function CommandPalette({ isOpen, onClose, incidents, vehicles, onSelectIncident, onSelectVehicle, onAction }) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const results = useMemo(() => {
        const items = [];
        const q = query.toLowerCase();

        // Actions
        const actions = [
            { type: 'action', id: 'report', label: 'Report New Incident', desc: 'Open incident report form', icon: 'alert', action: 'report' },
            { type: 'action', id: 'analytics', label: 'Toggle Analytics Dashboard', desc: 'Switch between map and analytics', icon: 'zap', action: 'analytics' },
            { type: 'action', id: 'copilot', label: 'Open AI Copilot', desc: 'Ask AI about the crisis', icon: 'zap', action: 'copilot' },
        ];

        actions.forEach(a => {
            if (!q || a.label.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q)) {
                items.push(a);
            }
        });

        // Incidents
        if (incidents) {
            incidents.forEach(inc => {
                const searchable = `${inc.original_message} ${inc.category} ${inc.venue_name} ${inc.location_text || inc.location}`.toLowerCase();
                if (!q || searchable.includes(q)) {
                    items.push({
                        type: 'incident',
                        id: inc.id,
                        label: inc.original_message?.substring(0, 60) + (inc.original_message?.length > 60 ? '...' : ''),
                        desc: `${inc.category} • ${inc.priority} • ${inc.status}`,
                        severity: inc.severity_score,
                        priority: inc.priority,
                        data: inc,
                    });
                }
            });
        }

        // Vehicles
        if (vehicles) {
            vehicles.forEach(v => {
                const searchable = `${v.name} ${v.type} ${v.status}`.toLowerCase();
                if (!q || searchable.includes(q)) {
                    items.push({
                        type: 'vehicle',
                        id: v.id,
                        label: v.name,
                        desc: `${v.type} • ${v.status}`,
                        data: v,
                    });
                }
            });
        }

        return items.slice(0, 12);
    }, [query, incidents, vehicles]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    const handleSelect = (item) => {
        if (item.type === 'incident') {
            onSelectIncident?.(item.data);
        } else if (item.type === 'vehicle') {
            onSelectVehicle?.(item.data);
        } else if (item.type === 'action') {
            onAction?.(item.action);
        }
        onClose();
    };

    const getIcon = (item) => {
        if (item.type === 'incident') return <AlertCircle size={16} className={`cmd-icon priority-${(item.priority || 'moderate').toLowerCase()}`} />;
        if (item.type === 'vehicle') return <Truck size={16} className="cmd-icon vehicle" />;
        if (item.icon === 'alert') return <AlertCircle size={16} className="cmd-icon action" />;
        return <Zap size={16} className="cmd-icon action" />;
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                className="cmd-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                role="dialog"
                aria-label="Command palette"
            >
                <motion.div
                    className="cmd-palette glass"
                    initial={{ opacity: 0, y: -20, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.96 }}
                    transition={{ duration: 0.2 }}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="cmd-search-bar">
                        <Search size={18} className="cmd-search-icon" />
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder="Search incidents, vehicles, or actions..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            aria-label="Search command palette"
                        />
                        <div className="cmd-shortcut-hint">ESC</div>
                    </div>

                    <div className="cmd-results">
                        {results.length === 0 ? (
                            <div className="cmd-empty">
                                <MapPin size={20} />
                                <span>No results found</span>
                            </div>
                        ) : (
                            results.map((item, idx) => (
                                <button
                                    key={`${item.type}-${item.id}`}
                                    className={`cmd-result-item ${idx === selectedIndex ? 'selected' : ''}`}
                                    onClick={() => handleSelect(item)}
                                    onMouseEnter={() => setSelectedIndex(idx)}
                                >
                                    {getIcon(item)}
                                    <div className="cmd-result-text">
                                        <span className="cmd-result-label">{item.label}</span>
                                        <span className="cmd-result-desc">{item.desc}</span>
                                    </div>
                                    <span className="cmd-result-type">{item.type}</span>
                                </button>
                            ))
                        )}
                    </div>

                    <div className="cmd-footer">
                        <span>↑↓ Navigate</span>
                        <span>↵ Select</span>
                        <span>ESC Close</span>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
