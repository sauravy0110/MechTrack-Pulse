/**
 * JobLifecycleTracker — Visual 12-stage CNC production pipeline tracker
 * Shows current stage with completion animation and provides stage context.
 */

const CNC_STAGES = [
    { key: 'created',              label: 'Job Created',        icon: '📋', desc: 'Specs verified & locked' },
    { key: 'planned',              label: 'Process Planned',    icon: '🗂️', desc: 'Operations sequence locked' },
    { key: 'ready',                label: 'Material Ready',     icon: '📦', desc: 'Raw material validated' },
    { key: 'assigned',             label: 'Assigned',           icon: '👷', desc: 'Operator & machine assigned' },
    { key: 'setup',                label: 'Setup Phase',        icon: '⚙️', desc: 'Machine setup in progress' },
    { key: 'setup_done',           label: 'Setup Done',         icon: '✅', desc: 'Setup image verified' },
    { key: 'first_piece_approval', label: 'First Piece QC',    icon: '🔬', desc: 'First piece inspection' },
    { key: 'in_progress',          label: 'Production',         icon: '🏭', desc: 'Full production running' },
    { key: 'qc_check',             label: 'QC Check',           icon: '📏', desc: 'In-process measurements' },
    { key: 'final_inspection',     label: 'Final Inspection',   icon: '🎯', desc: 'AI final inspection' },
    { key: 'dispatched',           label: 'Dispatched',         icon: '🚚', desc: 'Packed and dispatched' },
    { key: 'completed',            label: 'Completed',          icon: '🏆', desc: 'Job completed' },
];

function getStageIndex(status) {
    const idx = CNC_STAGES.findIndex((s) => s.key === status);
    return idx >= 0 ? idx : -1;
}

export default function JobLifecycleTracker({ task, compact = false }) {
    const currentIdx = getStageIndex(task?.status);
    const isRework = task?.rework_flag;

    if (!task) return null;

    // Non-CNC tasks — show a simplified view
    if (currentIdx < 0) {
        return (
            <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Status: <strong style={{ color: 'var(--text-primary)' }}>{task.status}</strong></span>
            </div>
        );
    }

    if (compact) {
        return <CompactTracker currentIdx={currentIdx} isRework={isRework} />;
    }

    return (
        <div className="job-lifecycle-tracker" style={{ padding: '0' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🏭 Production Pipeline
                </h4>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Stage {currentIdx + 1} / {CNC_STAGES.length}
                </span>
            </div>

            {/* Rework badge */}
            {isRework && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)',
                    borderRadius: '8px', padding: '6px 12px', marginBottom: '12px', fontSize: '11px', color: '#FBBF24',
                }}>
                    🔁 Rework in progress — Iteration #{task.rework_iteration || 1}
                </div>
            )}

            {/* Stage list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {CNC_STAGES.map((stage, idx) => {
                    const isDone = idx < currentIdx;
                    const isCurrent = idx === currentIdx;
                    const isPending = idx > currentIdx;

                    return (
                        <div key={stage.key} style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '7px 10px', borderRadius: '8px',
                            background: isCurrent ? 'rgba(99,102,241,0.12)' : 'transparent',
                            border: isCurrent ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
                            transition: 'all 0.2s ease',
                        }}>
                            {/* Step indicator */}
                            <div style={{
                                width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: isDone ? '13px' : (isCurrent ? '12px' : '10px'),
                                background: isDone
                                    ? 'rgba(52,211,153,0.2)'
                                    : isCurrent
                                        ? 'rgba(99,102,241,0.3)'
                                        : 'rgba(255,255,255,0.04)',
                                border: isDone
                                    ? '1px solid rgba(52,211,153,0.4)'
                                    : isCurrent
                                        ? '1px solid rgba(99,102,241,0.5)'
                                        : '1px solid rgba(255,255,255,0.08)',
                                color: isDone ? '#34D399' : isCurrent ? '#818CF8' : 'var(--text-muted)',
                            }}>
                                {isDone ? '✓' : isCurrent ? stage.icon : `${idx + 1}`}
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: '12px', fontWeight: isCurrent ? 700 : (isDone ? 500 : 400),
                                    color: isDone ? '#34D399' : isCurrent ? '#A5B4FC' : 'var(--text-muted)',
                                    lineHeight: 1.3,
                                }}>
                                    {stage.label}
                                </div>
                                {isCurrent && (
                                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>
                                        {stage.desc}
                                    </div>
                                )}
                            </div>

                            {/* Current pulse */}
                            {isCurrent && (
                                <div style={{
                                    width: '6px', height: '6px', borderRadius: '50%',
                                    background: '#818CF8', flexShrink: 0,
                                    animation: 'pulse 2s ease-in-out infinite',
                                }} />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Progress bar */}
            <div style={{ marginTop: '12px' }}>
                <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                        height: '100%',
                        width: `${Math.round(((currentIdx + 1) / CNC_STAGES.length) * 100)}%`,
                        background: 'linear-gradient(90deg, #6366F1, #8B5CF6)',
                        borderRadius: '4px',
                        transition: 'width 0.5s ease',
                    }} />
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'right', marginTop: '4px' }}>
                    {Math.round(((currentIdx + 1) / CNC_STAGES.length) * 100)}% complete
                </div>
            </div>
        </div>
    );
}

function CompactTracker({ currentIdx, isRework }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto', padding: '4px 0' }}>
            {CNC_STAGES.map((stage, idx) => {
                const isDone = idx < currentIdx;
                const isCurrent = idx === currentIdx;
                return (
                    <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <div style={{
                            width: '20px', height: '20px', borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '8px',
                            background: isDone ? 'rgba(52,211,153,0.2)' : isCurrent ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.04)',
                            border: isDone ? '1px solid #34D399' : isCurrent ? '1px solid #818CF8' : '1px solid rgba(255,255,255,0.08)',
                            color: isDone ? '#34D399' : isCurrent ? '#A5B4FC' : 'rgba(255,255,255,0.2)',
                            title: stage.label,
                        }}>
                            {isDone ? '✓' : isCurrent ? '●' : ''}
                        </div>
                        {idx < CNC_STAGES.length - 1 && (
                            <div style={{
                                width: '12px', height: '1px',
                                background: idx < currentIdx ? '#34D399' : 'rgba(255,255,255,0.08)',
                            }} />
                        )}
                    </div>
                );
            })}
            {isRework && <span style={{ fontSize: '10px', color: '#FBBF24', marginLeft: '4px' }}>↺</span>}
        </div>
    );
}

export { CNC_STAGES, getStageIndex };
