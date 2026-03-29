import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, X, MapPin } from 'lucide-react';
import './App.css';

export default function NotificationToast({ notifications, onDismiss, onFocus }) {
    return (
        <div className="toast-container" aria-live="assertive">
            <AnimatePresence>
                {notifications.map((n) => (
                    <motion.div
                        key={n.id}
                        className={`toast-item severity-${n.severity_score >= 8 ? 'critical' : 'high'}`}
                        initial={{ opacity: 0, x: 340, scale: 0.8 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 340, scale: 0.8 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                        onClick={() => onFocus(n)}
                        role="alert"
                    >
                        <div className="toast-icon-area">
                            <AlertCircle size={22} />
                        </div>
                        <div className="toast-body">
                            <span className="toast-title">{n.category || 'New Incident'}</span>
                            <p className="toast-msg">{(n.original_message || '').slice(0, 90)}</p>
                            <span className="toast-meta">
                                <MapPin size={11} />
                                {n.venue_name || n.location_text || 'Unknown'} • Severity {n.severity_score}/10
                            </span>
                        </div>
                        <button
                            className="toast-close"
                            onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
                            aria-label="Dismiss"
                        >
                            <X size={14} />
                        </button>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
