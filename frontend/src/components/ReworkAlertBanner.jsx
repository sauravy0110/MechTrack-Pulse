/**
 * ReworkAlertBanner — Dismissible alert shown when a job is in rework loop.
 * Shows iteration count, reason, and reassign operator controls.
 */

import { useState } from 'react';
import useAppStore from '../stores/appStore';

export default function ReworkAlertBanner({ task, onReassign }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [selectedOperator, setSelectedOperator] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const operators = useAppStore((s) => s.operators);

    if (!task?.rework_flag) return null;

    const handleReassign = async () => {
        if (!selectedOperator) return;
        setSubmitting(true);
        try {
            if (onReassign) await onReassign(selectedOperator);
            setIsExpanded(false);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{
            background: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(245,158,11,0.08))',
            border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '8px',
        }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                    <span style={{ fontSize: '18px' }}>🔁</span>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#FBBF24' }}>
                            Rework in Progress — Iteration #{task.rework_iteration || 1}
                        </div>
                        {task.rework_reason && (
                            <div style={{ fontSize: '11px', color: 'rgba(251,191,36,0.7)', marginTop: '2px' }}>
                                {task.rework_reason}
                            </div>
                        )}
                    </div>
                </div>
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    style={{
                        background: 'rgba(251,191,36,0.15)',
                        border: '1px solid rgba(251,191,36,0.3)',
                        borderRadius: '6px',
                        color: '#FBBF24',
                        fontSize: '11px',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        flexShrink: 0,
                    }}
                >
                    {isExpanded ? 'Collapse ▲' : 'Reassign ▼'}
                </button>
            </div>

            {/* Expandable reassign panel */}
            {isExpanded && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(251,191,36,0.15)' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px', fontWeight: 600 }}>
                        REASSIGN OPERATOR
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <select
                            value={selectedOperator}
                            onChange={(e) => setSelectedOperator(e.target.value)}
                            style={{
                                flex: 1,
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(251,191,36,0.2)',
                                borderRadius: '8px',
                                color: 'var(--text-primary)',
                                padding: '8px 10px',
                                fontSize: '12px',
                                cursor: 'pointer',
                            }}
                        >
                            <option value="">Select operator...</option>
                            {operators
                                .filter((op) => op.is_on_duty)
                                .map((op) => (
                                    <option key={op.id} value={op.id}>
                                        {op.full_name} ({op.current_task_count || 0} tasks)
                                    </option>
                                ))
                            }
                        </select>
                        <button
                            onClick={handleReassign}
                            disabled={!selectedOperator || submitting}
                            style={{
                                background: selectedOperator ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(251,191,36,0.3)',
                                borderRadius: '8px',
                                color: selectedOperator ? '#FBBF24' : 'var(--text-muted)',
                                fontSize: '12px',
                                fontWeight: 600,
                                padding: '8px 14px',
                                cursor: selectedOperator ? 'pointer' : 'not-allowed',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {submitting ? '…' : '↗ Assign'}
                        </button>
                    </div>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '6px' }}>
                        AI suggestion: Select the operator with the most available capacity for fastest rework resolution.
                    </div>
                </div>
            )}
        </div>
    );
}
