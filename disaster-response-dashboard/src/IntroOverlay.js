import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Activity, Map, Server, Lock, CheckCircle } from 'lucide-react';
import './App.css';

const steps = [
    { text: "ESTABLISHING SECURE CONNECTION...", icon: Lock, color: "#3b82f6" },
    { text: "VERIFYING BIOMETRICS...", icon: Shield, color: "#10b981" },
    { text: "SYNCING MUMBAI GEOSPATIAL DATA...", icon: Map, color: "#f59e0b" },
    { text: "CONNECTING TO RESCUE FLEET GRID...", icon: Server, color: "#ec4899" },
    { text: "SYSTEM ONLINE", icon: CheckCircle, color: "#10b981" }
];

export default function IntroOverlay({ onComplete }) {
    const [currentStep, setCurrentStep] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentStep(prev => {
                if (prev < steps.length) {
                    return prev + 1;
                } else {
                    clearInterval(interval);
                    setTimeout(onComplete, 800);
                    return prev;
                }
            });
        }, 1200);

        return () => clearInterval(interval);
    }, [onComplete]);

    return (
        <motion.div
            className="intro-overlay"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(10px)" }}
            transition={{ duration: 0.8 }}
        >
            <div className="debug-skip" style={{ position: 'absolute', top: 20, right: 20, zIndex: 10000, cursor: 'pointer', color: 'red', border: '1px solid red', padding: '5px' }} onClick={onComplete}>
                [DEBUG: FORCE SKIP]
            </div>
            <div className="scan-line"></div>

            <div className="intro-content">
                <motion.div
                    className="logo-container"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5 }}
                >
                    <Activity size={64} color="#ef4444" className="pulse-fast" />
                    <h1 className="glitch-text">DISASTER OS v2.0</h1>
                </motion.div>

                <div className="loading-steps">
                    {steps.map((step, index) => (
                        <div key={index} className="step-row">
                            <div className="step-icon">
                                {index <= currentStep && (
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                    >
                                        <step.icon size={20} color={step.color} />
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
                                        {step.text} {index < currentStep && " [OK]"}
                                    </motion.span>
                                ) : (
                                    <span className="pending-text">...</span>
                                )}
                            </div>
                        </div>
                    ))}
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
