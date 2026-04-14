import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Activity, Map, Server, Lock, CheckCircle, Radio, Wifi } from 'lucide-react';
import './App.css';

const steps = [
    { text: "ESTABLISHING SECURE CONNECTION...", icon: Lock, color: "#3b82f6" },
    { text: "AUTHENTICATING OPERATOR CREDENTIALS...", icon: Shield, color: "#10b981" },
    { text: "LOADING MUMBAI GEOSPATIAL LAYERS...", icon: Map, color: "#f59e0b" },
    { text: "CONNECTING TO SATELLITE UPLINK...", icon: Wifi, color: "#8b5cf6" },
    { text: "SYNCING RESCUE FLEET TELEMETRY...", icon: Radio, color: "#ec4899" },
    { text: "ACTIVATING AI COPILOT [GEMINI]...", icon: Server, color: "#06b6d4" },
    { text: "ALL SYSTEMS NOMINAL", icon: CheckCircle, color: "#10b981" }
];

export default function IntroOverlay({ onComplete }) {
    const [currentStep, setCurrentStep] = useState(0);
    const [glitchActive, setGlitchActive] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentStep(prev => {
                if (prev < steps.length) {
                    return prev + 1;
                } else {
                    clearInterval(interval);
                    setTimeout(onComplete, 600);
                    return prev;
                }
            });
        }, 900);

        return () => clearInterval(interval);
    }, [onComplete]);

    // Glitch effect trigger
    useEffect(() => {
        const glitchInterval = setInterval(() => {
            setGlitchActive(true);
            setTimeout(() => setGlitchActive(false), 150);
        }, 3000);
        return () => clearInterval(glitchInterval);
    }, []);

    return (
        <motion.div
            className="intro-overlay"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(10px)" }}
            transition={{ duration: 0.8 }}
            role="status"
            aria-label="System initializing"
        >
            <div className="scan-line" aria-hidden="true"></div>
            <div className="intro-grid-bg" aria-hidden="true"></div>

            <div className="intro-content">
                <motion.div
                    className="logo-container"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5 }}
                >
                    <div className="intro-logo-ring" aria-hidden="true">
                        <Activity size={48} color="#ef4444" className="pulse-fast" />
                    </div>
                    <div className="intro-title-block">
                        <h1 className={`glitch-text ${glitchActive ? 'glitch-active' : ''}`} data-text="DISASTER OS v3.0">
                            DISASTER OS v3.0
                        </h1>
                        <span className="intro-subtitle">MUMBAI RAPID CRISIS RESPONSE</span>
                    </div>
                </motion.div>

                <div className="loading-steps">
                    {steps.map((step, index) => (
                        <div key={index} className="step-row">
                            <div className="step-icon" aria-hidden="true">
                                {index <= currentStep && (
                                    <motion.div
                                        initial={{ scale: 0, rotate: -90 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        transition={{ type: "spring", stiffness: 300 }}
                                    >
                                        <step.icon size={18} color={step.color} />
                                    </motion.div>
                                )}
                            </div>
                            <div className="step-text">
                                {index <= currentStep ? (
                                    <motion.span
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className={index === currentStep && currentStep !== steps.length ? "typing-effect" : "done-text"}
                                    >
                                        {step.text} {index < currentStep && <span className="step-ok">[OK]</span>}
                                    </motion.span>
                                ) : (
                                    <span className="pending-text">...</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="intro-stats-row">
                    <div className="intro-stat">
                        <span className="intro-stat-value">18</span>
                        <span className="intro-stat-label">SECTORS</span>
                    </div>
                    <div className="intro-stat">
                        <span className="intro-stat-value">4</span>
                        <span className="intro-stat-label">UNITS</span>
                    </div>
                    <div className="intro-stat">
                        <span className="intro-stat-value">AI</span>
                        <span className="intro-stat-label">GEMINI</span>
                    </div>
                </div>

                <div className="progress-bar-container">
                    <motion.div
                        className="progress-bar-fill"
                        initial={{ width: "0%" }}
                        animate={{ width: `${Math.min((currentStep / (steps.length - 1)) * 100, 100)}%` }}
                        transition={{ duration: 0.5 }}
                    />
                </div>
            </div>
        </motion.div>
    );
}
