import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Activity, Clock, ShieldCheck, TrendingUp, AlertTriangle } from 'lucide-react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import './App.css';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler);

const CHART_COLORS = {
    critical: '#ef4444',
    high: '#f59e0b',
    moderate: '#10b981',
    blue: '#3b82f6',
    purple: '#8b5cf6',
    pink: '#ec4899',
    orange: '#f97316',
    teal: '#14b8a6',
    cyan: '#06b6d4',
};

const CATEGORY_COLORS = [
    CHART_COLORS.critical, CHART_COLORS.blue, CHART_COLORS.orange,
    CHART_COLORS.purple, CHART_COLORS.teal, CHART_COLORS.pink,
    CHART_COLORS.cyan, CHART_COLORS.high, CHART_COLORS.moderate,
];

export default function AnalyticsDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAnalytics = async () => {
            try {
                const res = await fetch('http://127.0.0.1:5001/analytics');
                if (res.ok) {
                    const json = await res.json();
                    setData(json);
                }
            } catch (err) {
                console.error('Analytics fetch failed:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchAnalytics();
        const interval = setInterval(fetchAnalytics, 15000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="analytics-loading">
                <div className="loader" />
                <p>Loading Analytics...</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="analytics-loading">
                <AlertTriangle size={32} color="#f59e0b" />
                <p>Unable to load analytics. Ensure the backend is running.</p>
            </div>
        );
    }

    const categoryLabels = Object.keys(data.by_category);
    const categoryValues = Object.values(data.by_category);

    const categoryChart = {
        labels: categoryLabels,
        datasets: [{
            data: categoryValues,
            backgroundColor: CATEGORY_COLORS.slice(0, categoryLabels.length),
            borderWidth: 0,
            hoverOffset: 8,
        }],
    };

    const priorityChart = {
        labels: ['Critical', 'High', 'Moderate'],
        datasets: [{
            label: 'Incidents',
            data: [data.by_priority.Critical, data.by_priority.High, data.by_priority.Moderate],
            backgroundColor: [CHART_COLORS.critical + 'cc', CHART_COLORS.high + 'cc', CHART_COLORS.moderate + 'cc'],
            borderColor: [CHART_COLORS.critical, CHART_COLORS.high, CHART_COLORS.moderate],
            borderWidth: 1,
            borderRadius: 6,
        }],
    };

    const hourLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    const hourlyChart = {
        labels: hourLabels,
        datasets: [{
            label: 'Incidents',
            data: data.hourly_distribution,
            fill: true,
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            borderColor: CHART_COLORS.blue,
            tension: 0.4,
            pointRadius: 2,
            pointHoverRadius: 5,
        }],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                titleColor: '#f8fafc',
                bodyColor: '#94a3b8',
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1,
                cornerRadius: 8,
                padding: 10,
            },
        },
        scales: {
            x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true },
        },
    };

    const doughnutOptions = {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
            legend: {
                position: 'bottom',
                labels: { color: '#94a3b8', font: { size: 11 }, padding: 14, usePointStyle: true, pointStyleWidth: 10 },
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                titleColor: '#f8fafc',
                bodyColor: '#94a3b8',
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1,
                cornerRadius: 8,
                padding: 10,
            },
        },
    };

    return (
        <motion.div
            className="analytics-dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
        >
            {/* KPI Summary Cards */}
            <div className="analytics-kpi-row">
                <div className="analytics-kpi-card">
                    <div className="analytics-kpi-icon" style={{ background: 'rgba(59,130,246,0.15)' }}>
                        <BarChart3 size={20} color={CHART_COLORS.blue} />
                    </div>
                    <div>
                        <span className="analytics-kpi-label">Total Incidents</span>
                        <span className="analytics-kpi-value">{data.total_incidents}</span>
                    </div>
                </div>
                <div className="analytics-kpi-card">
                    <div className="analytics-kpi-icon" style={{ background: 'rgba(239,68,68,0.15)' }}>
                        <Activity size={20} color={CHART_COLORS.critical} />
                    </div>
                    <div>
                        <span className="analytics-kpi-label">Active</span>
                        <span className="analytics-kpi-value">{data.active_count}</span>
                    </div>
                </div>
                <div className="analytics-kpi-card">
                    <div className="analytics-kpi-icon" style={{ background: 'rgba(16,185,129,0.15)' }}>
                        <ShieldCheck size={20} color={CHART_COLORS.moderate} />
                    </div>
                    <div>
                        <span className="analytics-kpi-label">Resolved</span>
                        <span className="analytics-kpi-value">{data.resolved_count}</span>
                    </div>
                </div>
                <div className="analytics-kpi-card">
                    <div className="analytics-kpi-icon" style={{ background: 'rgba(139,92,246,0.15)' }}>
                        <Clock size={20} color={CHART_COLORS.purple} />
                    </div>
                    <div>
                        <span className="analytics-kpi-label">Avg Resolve</span>
                        <span className="analytics-kpi-value">{data.avg_resolve_minutes ? `${data.avg_resolve_minutes}m` : '--'}</span>
                    </div>
                </div>
            </div>

            {/* Charts Grid */}
            <div className="analytics-charts-grid">
                <div className="analytics-chart-card">
                    <h3><TrendingUp size={16} /> Incidents by Category</h3>
                    <div className="chart-wrapper doughnut-wrapper">
                        <Doughnut data={categoryChart} options={doughnutOptions} />
                    </div>
                </div>

                <div className="analytics-chart-card">
                    <h3><AlertTriangle size={16} /> Incidents by Priority</h3>
                    <div className="chart-wrapper">
                        <Bar data={priorityChart} options={chartOptions} />
                    </div>
                </div>

                <div className="analytics-chart-card wide">
                    <h3><Clock size={16} /> Hourly Distribution (Last 24h)</h3>
                    <div className="chart-wrapper">
                        <Line data={hourlyChart} options={chartOptions} />
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
