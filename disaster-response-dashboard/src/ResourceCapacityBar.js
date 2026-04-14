import React from 'react';
import { Activity, Shield, Flame, Truck } from 'lucide-react';
import './App.css';

export default function ResourceCapacityBar({ resources }) {
    if (!resources || resources.length === 0) return null;

    const byType = {};
    resources.forEach(r => {
        if (!byType[r.type]) {
            byType[r.type] = { total: 0, idle: 0, dispatched: 0, busy: 0 };
        }
        byType[r.type].total += 1;
        if (r.status === 'IDLE') byType[r.type].idle += 1;
        else if (r.status === 'DISPATCHED') byType[r.type].dispatched += 1;
        else byType[r.type].busy += 1;
    });

    const totalIdle = resources.filter(r => r.status === 'IDLE').length;
    const totalCount = resources.length;
    const utilizationPct = totalCount > 0 ? Math.round(((totalCount - totalIdle) / totalCount) * 100) : 0;

    const typeConfig = {
        ambulance: { icon: Activity, label: 'AMB', color: '#ef4444' },
        police: { icon: Shield, label: 'POL', color: '#3b82f6' },
        fire: { icon: Flame, label: 'FIRE', color: '#f97316' },
    };

    return (
        <div className="capacity-bar" role="status" aria-label="Resource capacity">
            <div className="capacity-utilization">
                <div className="capacity-ring" style={{ '--pct': utilizationPct }}>
                    <svg viewBox="0 0 36 36" className="capacity-svg">
                        <path
                            className="capacity-ring-bg"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                            className="capacity-ring-fill"
                            strokeDasharray={`${utilizationPct}, 100`}
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            style={{ stroke: utilizationPct > 75 ? '#ef4444' : utilizationPct > 50 ? '#f59e0b' : '#10b981' }}
                        />
                    </svg>
                    <span className="capacity-pct">{utilizationPct}%</span>
                </div>
                <span className="capacity-label">FLEET</span>
            </div>

            {Object.entries(byType).map(([type, counts]) => {
                const config = typeConfig[type] || { icon: Truck, label: type.toUpperCase(), color: '#64748b' };
                const Icon = config.icon;
                const pct = counts.total > 0 ? Math.round((counts.idle / counts.total) * 100) : 0;
                return (
                    <div key={type} className="capacity-unit" title={`${config.label}: ${counts.idle}/${counts.total} available`}>
                        <Icon size={14} style={{ color: config.color }} />
                        <div className="capacity-unit-bar">
                            <div
                                className="capacity-unit-fill"
                                style={{
                                    width: `${pct}%`,
                                    backgroundColor: pct > 50 ? '#10b981' : pct > 0 ? '#f59e0b' : '#ef4444'
                                }}
                            />
                        </div>
                        <span className="capacity-unit-count">{counts.idle}/{counts.total}</span>
                    </div>
                );
            })}
        </div>
    );
}
