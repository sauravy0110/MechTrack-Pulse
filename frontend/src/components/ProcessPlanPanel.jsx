/**
 * ProcessPlanPanel — The supervisor's process planning workspace.
 * Features: AI suggest, manual add, drag-reorder indicator, AI validate, lock.
 * Used inside the RightPanel when a created/planned job is selected.
 */

import { useState, useEffect } from 'react';
import useAppStore from '../stores/appStore';

export default function ProcessPlanPanel({ task }) {
    const {
        jobProcesses, fetchJobProcesses, aiSuggestProcesses,
        validateProcessPlan, lockProcessPlan, loadingJobProcesses,
    } = useAppStore();

    const [suggesting, setSuggesting] = useState(false);
    const [validating, setValidating] = useState(false);
    const [locking, setLocking] = useState(false);
    const [validation, setValidation] = useState(null);
    const [addAlert, setAddAlert] = useLocalAlert();

    const processData = jobProcesses[task?.id];
    const operations = processData?.operations || [];
    const totalTime = processData?.total_cycle_time_minutes || 0;
    const isJobLocked = task?.status === 'planned' || task?.is_locked && task?.status !== 'created';

    useEffect(() => {
        if (task?.id) fetchJobProcesses(task.id);
    }, [task?.id]);

    const handleSuggest = async () => {
        setSuggesting(true);
        setValidation(null);
        try {
            await aiSuggestProcesses(task.id);
        } catch (e) {
            setAddAlert(e.message, 'error');
        } finally {
            setSuggesting(false);
        }
    };

    const handleValidate = async () => {
        setValidating(true);
        try {
            const result = await validateProcessPlan(task.id);
            setValidation(result);
        } catch (e) {
            setAddAlert(e.message, 'error');
        } finally {
            setValidating(false);
        }
    };

    const handleLock = async () => {
        if (!window.confirm(`Lock process plan with ${operations.length} operations? This cannot be undone.`)) return;
        setLocking(true);
        try {
            await lockProcessPlan(task.id);
        } catch (e) {
            setAddAlert(e.message, 'error');
        } finally {
            setLocking(false);
        }
    };

    if (!task) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🗂️ Process Plan
                    {operations.length > 0 && (
                        <span style={{
                            fontSize: '10px', background: 'rgba(99,102,241,0.2)', color: '#A5B4FC',
                            borderRadius: '10px', padding: '1px 8px', fontWeight: 600,
                        }}>
                            {operations.length} ops · {totalTime} min
                        </span>
                    )}
                </h4>
                {!isJobLocked && (
                    <button
                        onClick={handleSuggest}
                        disabled={suggesting}
                        style={{
                            background: 'rgba(99,102,241,0.15)',
                            border: '1px solid rgba(99,102,241,0.3)',
                            borderRadius: '8px', color: '#A5B4FC',
                            fontSize: '11px', fontWeight: 600,
                            padding: '5px 12px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '5px',
                        }}
                    >
                        {suggesting ? (
                            <><span style={{ animation: 'spin 1s linear infinite' }}>⟳</span> Suggesting…</>
                        ) : (
                            <><span>✨</span> AI Suggest</>
                        )}
                    </button>
                )}
            </div>

            {/* Operations list */}
            {loadingJobProcesses ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
                    Loading operations…
                </div>
            ) : operations.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '24px 16px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px dashed rgba(255,255,255,0.1)',
                    borderRadius: '10px',
                }}>
                    <div style={{ fontSize: '24px', marginBottom: '8px' }}>🗂️</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                        No operations defined
                    </div>
                    {!isJobLocked && (
                        <div style={{ fontSize: '11px', color: '#A5B4FC', opacity: 0.7 }}>
                            Click "AI Suggest" to generate a process plan from drawing specs
                        </div>
                    )}
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {operations.map((op, idx) => (
                        <OperationRow key={op.id} op={op} idx={idx} isJobLocked={isJobLocked} />
                    ))}
                </div>
            )}

            {/* AI Validation result */}
            {validation && (
                <div style={{
                    padding: '10px 14px',
                    background: validation.status === 'success'
                        ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)',
                    border: `1px solid ${validation.status === 'success' ? 'rgba(52,211,153,0.2)' : 'rgba(251,191,36,0.2)'}`,
                    borderRadius: '10px', fontSize: '12px',
                }}>
                    <div style={{ fontWeight: 600, color: validation.status === 'success' ? '#34D399' : '#FBBF24', marginBottom: '6px' }}>
                        {validation.status === 'success' ? '✅' : '⚠️'} {validation.message}
                    </div>
                    {validation.issues?.length > 0 && validation.issues.map((issue, i) => (
                        <div key={i} style={{ fontSize: '11px', color: '#FBBF24', marginBottom: '2px' }}>• {issue}</div>
                    ))}
                    {validation.suggestions?.length > 0 && validation.suggestions.map((s, i) => (
                        <div key={i} style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>→ {s}</div>
                    ))}
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '4px' }}>
                        AI confidence: {Math.round((validation.confidence || 0) * 100)}%
                    </div>
                </div>
            )}

            {/* Local alert */}
            {addAlert.message && (
                <div style={{
                    padding: '8px 12px', fontSize: '12px',
                    background: addAlert.type === 'error' ? 'rgba(248,113,113,0.1)' : 'rgba(99,102,241,0.1)',
                    border: `1px solid ${addAlert.type === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(99,102,241,0.3)'}`,
                    borderRadius: '8px',
                    color: addAlert.type === 'error' ? '#F87171' : '#A5B4FC',
                }}>
                    {addAlert.message}
                </div>
            )}

            {/* Action buttons */}
            {!isJobLocked && operations.length > 0 && (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={handleValidate}
                        disabled={validating}
                        style={{
                            flex: 1, padding: '9px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                            background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)',
                            color: '#22D3EE', cursor: 'pointer',
                        }}
                    >
                        {validating ? '⟳ Validating…' : '🧪 AI Validate'}
                    </button>
                    <button
                        onClick={handleLock}
                        disabled={locking}
                        style={{
                            flex: 1, padding: '9px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                            background: locking ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.2)',
                            border: '1px solid rgba(99,102,241,0.4)',
                            color: '#A5B4FC', cursor: locking ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {locking ? '⟳ Locking…' : '🔒 Lock Plan'}
                    </button>
                </div>
            )}

            {isJobLocked && (
                <div style={{
                    textAlign: 'center', fontSize: '11px', color: '#34D399',
                    padding: '8px', background: 'rgba(52,211,153,0.06)',
                    border: '1px solid rgba(52,211,153,0.15)', borderRadius: '8px',
                }}>
                    ✅ Process plan locked — Job status: planned
                </div>
            )}
        </div>
    );
}

function OperationRow({ op, idx, isJobLocked }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            padding: '8px 10px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
        }}>
            {/* Sequence badge */}
            <div style={{
                width: '24px', height: '24px', borderRadius: '6px',
                background: op.is_ai_suggested ? 'rgba(99,102,241,0.2)' : 'rgba(52,211,153,0.15)',
                border: op.is_ai_suggested ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(52,211,153,0.3)',
                color: op.is_ai_suggested ? '#A5B4FC' : '#34D399',
                fontSize: '11px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
            }}>
                {op.sequence_order}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                    {op.operation_name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                    {op.machine_name && (
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', padding: '1px 6px', borderRadius: '4px' }}>
                            ⚙️ {op.machine_name}
                        </span>
                    )}
                    {op.cycle_time_minutes && (
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', padding: '1px 6px', borderRadius: '4px' }}>
                            ⏱ {op.cycle_time_minutes} min
                        </span>
                    )}
                    {op.is_ai_suggested && (
                        <span style={{ fontSize: '10px', color: '#818CF8', background: 'rgba(99,102,241,0.1)', padding: '1px 6px', borderRadius: '4px' }}>
                            ✨ AI
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

// Simple local alert state hook
function useLocalAlert() {
    const [alert, setAlert] = useState({ message: '', type: 'error' });
    const set = (message, type = 'error') => {
        setAlert({ message, type });
        setTimeout(() => setAlert({ message: '', type: 'error' }), 4000);
    };
    return [alert, set];
}
