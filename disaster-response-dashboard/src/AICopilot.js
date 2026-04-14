import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Bot, Send, X, Sparkles, AlertTriangle, Info, ShieldAlert, Minimize2, Maximize2 } from 'lucide-react';
import './App.css';

export default function AICopilot({ isOpen, onClose }) {
    const [messages, setMessages] = useState([
        {
            role: 'ai',
            content: 'I\'m your AI Crisis Copilot powered by Gemini. Ask me about the current situation — incident analysis, resource status, area risks, or recommendations.',
            priority_flag: 'info',
            timestamp: new Date().toISOString(),
        }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const scrollRef = useRef(null);
    const inputRef = useRef(null);

    const quickQueries = [
        "What's the most critical incident right now?",
        "How many incidents are unresolved?",
        "Which area has the highest risk?",
        "Summarize the current situation",
    ];

    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = useCallback(async (queryText) => {
        const q = (queryText || input).trim();
        if (!q || loading) return;

        const userMsg = { role: 'user', content: q, timestamp: new Date().toISOString() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch('http://127.0.0.1:5001/ai_copilot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q }),
            });

            if (res.ok) {
                const data = await res.json();
                setMessages(prev => [...prev, {
                    role: 'ai',
                    content: data.answer || 'No response generated.',
                    recommendations: data.recommendations || [],
                    priority_flag: data.priority_flag || 'info',
                    related_ids: data.related_incident_ids || [],
                    timestamp: new Date().toISOString(),
                }]);
            } else {
                setMessages(prev => [...prev, {
                    role: 'ai',
                    content: 'Failed to get a response. Ensure the backend is running.',
                    priority_flag: 'warning',
                    timestamp: new Date().toISOString(),
                }]);
            }
        } catch (err) {
            setMessages(prev => [...prev, {
                role: 'ai',
                content: 'Connection error. Check backend connectivity.',
                priority_flag: 'warning',
                timestamp: new Date().toISOString(),
            }]);
        } finally {
            setLoading(false);
        }
    }, [input, loading]);

    if (!isOpen) return null;

    const flagIcon = (flag) => {
        if (flag === 'critical') return <ShieldAlert size={14} className="copilot-flag-critical" />;
        if (flag === 'warning') return <AlertTriangle size={14} className="copilot-flag-warning" />;
        return <Info size={14} className="copilot-flag-info" />;
    };

    return (
        <motion.div
            className={`copilot-panel glass ${minimized ? 'minimized' : ''}`}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            role="dialog"
            aria-label="AI Crisis Copilot"
        >
            <div className="copilot-header">
                <div className="copilot-title">
                    <div className="copilot-icon-wrap">
                        <Sparkles size={18} />
                    </div>
                    <span>AI Copilot</span>
                    <span className="copilot-badge">GEMINI</span>
                </div>
                <div className="copilot-header-actions">
                    <button
                        className="copilot-ctrl-btn"
                        onClick={() => setMinimized(!minimized)}
                        aria-label={minimized ? "Expand copilot" : "Minimize copilot"}
                    >
                        {minimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                    </button>
                    <button className="copilot-ctrl-btn" onClick={onClose} aria-label="Close copilot">
                        <X size={14} />
                    </button>
                </div>
            </div>

            {!minimized && (
                <>
                    <div className="copilot-messages" ref={scrollRef}>
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`copilot-msg ${msg.role}`}>
                                {msg.role === 'ai' && (
                                    <div className="copilot-msg-header">
                                        <Bot size={14} />
                                        <span>Copilot</span>
                                        {msg.priority_flag && flagIcon(msg.priority_flag)}
                                    </div>
                                )}
                                <p className="copilot-msg-text">{msg.content}</p>
                                {msg.recommendations && msg.recommendations.length > 0 && (
                                    <div className="copilot-recommendations">
                                        <span className="copilot-rec-label">Recommendations:</span>
                                        {msg.recommendations.map((rec, ri) => (
                                            <div key={ri} className="copilot-rec-item">
                                                <span className="copilot-rec-bullet">→</span> {rec}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {msg.related_ids && msg.related_ids.length > 0 && (
                                    <div className="copilot-related">
                                        Related: {msg.related_ids.map(id => `#${id}`).join(', ')}
                                    </div>
                                )}
                            </div>
                        ))}

                        {loading && (
                            <div className="copilot-msg ai">
                                <div className="copilot-msg-header">
                                    <Bot size={14} />
                                    <span>Copilot</span>
                                </div>
                                <div className="copilot-thinking">
                                    <span className="dot-pulse" />
                                    Analyzing...
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="copilot-quick-actions">
                        {quickQueries.map((q, i) => (
                            <button key={i} className="copilot-quick-btn" onClick={() => handleSend(q)} disabled={loading}>
                                {q}
                            </button>
                        ))}
                    </div>

                    <div className="copilot-input-area">
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder="Ask about the crisis situation..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                            disabled={loading}
                            aria-label="Copilot query input"
                        />
                        <button
                            className="copilot-send-btn"
                            onClick={() => handleSend()}
                            disabled={loading || !input.trim()}
                            aria-label="Send query"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </>
            )}
        </motion.div>
    );
}
