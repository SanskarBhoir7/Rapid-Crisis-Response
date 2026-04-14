import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Clock, ShieldAlert, X } from 'lucide-react';
import './App.css';

export default function EscalationBanner({ incidents, resources, onDismiss }) {
    const alerts = useMemo(() => {
        const result = [];
        const now = Date.now();

        // Check for unacknowledged critical incidents > 2 minutes
        if (incidents) {
            incidents.forEach(inc => {
                if (inc.priority === 'Critical' && inc.status === 'Created') {
                    const created = new Date(inc.timestamp).getTime();
                    if (Number.isFinite(created) && (now - created) > 2 * 60 * 1000) {
                        result.push({
                            id: `esc-unack-${inc.id}`,
                            type: 'unacknowledged',
                            icon: Clock,
                            message: `CRITICAL incident unacknowledged for ${Math.round((now - created) / 60000)}min: ${(inc.original_message || '').substring(0, 50)}...`,
                            severity: 'critical',
                        });
                    }
                }
            });
        }

        // Check for resource exhaustion
        if (resources) {
            const byType = {};
            resources.forEach(r => {
                if (!byType[r.type]) byType[r.type] = { total: 0, idle: 0 };
                byType[r.type].total += 1;
                if (r.status === 'IDLE') byType[r.type].idle += 1;
            });

            Object.entries(byType).forEach(([type, counts]) => {
                if (counts.idle === 0 && counts.total > 0) {
                    result.push({
                        id: `esc-capacity-${type}`,
                        type: 'capacity',
                        icon: ShieldAlert,
                        message: `All ${type} units deployed! No backup ${type} available.`,
                        severity: 'warning',
                    });
                }
            });
        }

        // Check for area clustering (3+ incidents in same zone)
        if (incidents) {
            const activeIncidents = incidents.filter(i => i.status !== 'Resolved' && i.coordinates);
            for (let i = 0; i < activeIncidents.length; i++) {
                let nearby = 0;
                for (let j = 0; j < activeIncidents.length; j++) {
                    if (i === j) continue;
                    const dist = Math.hypot(
                        activeIncidents[i].coordinates.lat - activeIncidents[j].coordinates.lat,
                        activeIncidents[i].coordinates.lng - activeIncidents[j].coordinates.lng
                    );
                    if (dist < 0.02) nearby++;
                }
                if (nearby >= 2) {
                    const area = activeIncidents[i].location_text || activeIncidents[i].venue_name || 'Unknown area';
                    const key = `esc-cluster-${Math.round(activeIncidents[i].coordinates.lat * 100)}`;
                    if (!result.some(r => r.id === key)) {
                        result.push({
                            id: key,
                            type: 'cluster',
                            icon: AlertTriangle,
                            message: `Multiple incidents clustered near ${area}. Possible large-scale event.`,
                            severity: 'warning',
                        });
                    }
                }
            }
        }

        return result.slice(0, 3); // Max 3 banners
    }, [incidents, resources]);

    if (alerts.length === 0) return null;

    return (
        <div className="escalation-container" role="alert" aria-live="assertive">
            <AnimatePresence>
                {alerts.map(alert => {
                    const Icon = alert.icon;
                    return (
                        <motion.div
                            key={alert.id}
                            className={`escalation-banner ${alert.severity}`}
                            initial={{ opacity: 0, y: -30, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                            exit={{ opacity: 0, y: -20, height: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <Icon size={16} className="escalation-icon" />
                            <span className="escalation-text">{alert.message}</span>
                            {onDismiss && (
                                <button className="escalation-close" onClick={() => onDismiss(alert.id)} aria-label="Dismiss alert">
                                    <X size={14} />
                                </button>
                            )}
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
