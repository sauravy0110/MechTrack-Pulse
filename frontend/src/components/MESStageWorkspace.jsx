import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import useAppStore from '../stores/appStore';

const CNC_STATUSES = new Set([
    'created',
    'planned',
    'ready',
    'assigned',
    'setup',
    'setup_done',
    'first_piece_approval',
    'qc_check',
    'final_inspection',
    'dispatched',
]);

function parseMeasurements(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .reduce((acc, line, index) => {
            const [label, ...rest] = line.split(':');
            if (rest.length > 0) {
                acc[label.trim()] = rest.join(':').trim();
            } else {
                acc[`entry_${index + 1}`] = line;
            }
            return acc;
        }, {});
}

function SectionShell({ title, children }) {
    return (
        <div className="glass-card rounded-2xl p-4 border border-border/70">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">{title}</div>
            <div className="space-y-3">{children}</div>
        </div>
    );
}

function StatPill({ label, value, tone = 'text-text-primary' }) {
    return (
        <div className="rounded-xl border border-border/60 bg-bg-hover/70 px-3 py-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">{label}</p>
            <p className={`mt-1 text-sm font-semibold ${tone}`}>{value}</p>
        </div>
    );
}

export default function MESStageWorkspace({ task, role, mesSummary, onRefresh }) {
    const addAlert = useAppStore((state) => state.addAlert);
    const updateTask = useAppStore((state) => state.updateTask);
    const updateTaskStatus = useAppStore((state) => state.updateTaskStatus);
    const operators = useAppStore((state) => state.operators);
    const machines = useAppStore((state) => state.machines);

    const [materialType, setMaterialType] = useState(task?.material_type || '');
    const [materialBatch, setMaterialBatch] = useState(task?.material_batch || '');
    const [assignOperatorId, setAssignOperatorId] = useState(task?.assigned_to || '');
    const [assignMachineId, setAssignMachineId] = useState(task?.machine_id || '');
    const [assignWithAI, setAssignWithAI] = useState(false);
    const [firstPieceMeasurements, setFirstPieceMeasurements] = useState('');
    const [firstPieceStatus, setFirstPieceStatus] = useState('pass');
    const [productionForm, setProductionForm] = useState({ produced_qty: '', rejected_qty: '', downtime_minutes: '', notes: '' });
    const [qcStatus, setQcStatus] = useState('pass');
    const [qcMeasurements, setQcMeasurements] = useState('');
    const [finalRemarks, setFinalRemarks] = useState('');
    const [dispatchForm, setDispatchForm] = useState({ packing_details: '', invoice_number: '', transport_details: '' });
    const [busyKey, setBusyKey] = useState('');
    const [finalApproved, setFinalApproved] = useState(false);

    const isCNCJob = Boolean(task?.is_locked || task?.part_name || CNC_STATUSES.has(task?.status));
    const canManage = role === 'owner' || role === 'supervisor';
    const canOperate = canManage || role === 'operator';

    useEffect(() => {
        setMaterialType(task?.material_type || '');
        setMaterialBatch(task?.material_batch || '');
        setAssignOperatorId(task?.assigned_to || '');
        setAssignMachineId(task?.machine_id || '');
        setAssignWithAI(false);
        setFirstPieceMeasurements('');
        setFirstPieceStatus('pass');
        setProductionForm({ produced_qty: '', rejected_qty: '', downtime_minutes: '', notes: '' });
        setQcStatus('pass');
        setQcMeasurements('');
        setFinalRemarks('');
        setDispatchForm({ packing_details: '', invoice_number: '', transport_details: '' });
        setFinalApproved(false);
    }, [task?.id, task?.material_type, task?.material_batch, task?.assigned_to, task?.machine_id]);

    const operatorOptions = useMemo(
        () => operators.filter((operator) => operator.is_on_duty && (operator.current_task_count || 0) < 5),
        [operators]
    );

    if (!isCNCJob) return null;

    const runAction = async (key, fn) => {
        setBusyKey(key);
        try {
            const result = await fn();
            const taskPayload = result?.data?.task || result?.task;
            if (taskPayload) {
                updateTask(taskPayload);
            }
            await onRefresh?.();
            return result?.data || result;
        } catch (error) {
            addAlert(error.response?.data?.detail || error.message || 'Unable to update MES stage.', 'error');
            return null;
        } finally {
            setBusyKey('');
        }
    };

    const productionTotals = mesSummary?.production_totals || { produced_qty: 0, rejected_qty: 0, downtime_minutes: 0, log_count: 0 };

    return (
        <div className="space-y-3">
            <SectionShell title="MES Workflow">
                <div className="rounded-xl border border-accent/15 bg-accent/5 px-3 py-3 text-xs leading-6 text-text-secondary">
                    Human-verified execution stays in control at every stage. AI can suggest, flag, and monitor, but release decisions remain with your team.
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <StatPill label="Status" value={task.status.replace(/_/g, ' ')} />
                    <StatPill label="Rework" value={task.rework_flag ? `Iteration ${task.rework_iteration || 1}` : 'No'} tone={task.rework_flag ? 'text-warning' : 'text-success'} />
                    <StatPill label="Produced" value={productionTotals.produced_qty || 0} />
                    <StatPill label="Rejected" value={productionTotals.rejected_qty || 0} tone={productionTotals.rejected_qty ? 'text-danger' : 'text-success'} />
                </div>
                {mesSummary?.client && (
                    <div className="rounded-xl border border-border/60 px-3 py-3 text-xs text-text-secondary">
                        Client visibility: <span className="font-semibold text-text-primary">{mesSummary.client.company_name}</span>
                        {task.rework_flag ? ' • Rework in progress' : ' • Verified data only'}
                    </div>
                )}
            </SectionShell>

            {canManage && (task.status === 'created' || task.status === 'planned') && (
                <SectionShell title="Material Validation">
                    <input value={materialType} onChange={(e) => setMaterialType(e.target.value)} placeholder="Material type" className="input-glass w-full rounded-xl px-4 py-3 text-sm" />
                    <input value={materialBatch} onChange={(e) => setMaterialBatch(e.target.value)} placeholder="Material batch" className="input-glass w-full rounded-xl px-4 py-3 text-sm" />
                    <button
                        type="button"
                        onClick={() => runAction('material', () => api.post(`/tasks/${task.id}/material-validation`, { material_type: materialType, material_batch: materialBatch }))}
                        className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                        disabled={busyKey === 'material'}
                    >
                        {busyKey === 'material' ? 'Validating...' : 'Validate Material'}
                    </button>
                </SectionShell>
            )}

            {canManage && (task.status === 'ready' || task.status === 'assigned' || task.rework_flag) && (
                <SectionShell title="Smart Assignment">
                    <select value={assignOperatorId} onChange={(e) => setAssignOperatorId(e.target.value)} className="input-glass w-full rounded-xl px-4 py-3 text-sm">
                        <option value="">Select operator</option>
                        {operatorOptions.map((operator) => (
                            <option key={operator.id} value={operator.id}>{operator.full_name}</option>
                        ))}
                    </select>
                    <select value={assignMachineId} onChange={(e) => setAssignMachineId(e.target.value)} className="input-glass w-full rounded-xl px-4 py-3 text-sm">
                        <option value="">Select machine</option>
                        {machines.map((machine) => (
                            <option key={machine.id} value={machine.id}>{machine.name}</option>
                        ))}
                    </select>
                    <label className="flex items-center gap-2 text-xs text-text-muted">
                        <input type="checkbox" checked={assignWithAI} onChange={(e) => setAssignWithAI(e.target.checked)} />
                        Use AI recommendations when fields are blank
                    </label>
                    <button
                        type="button"
                        onClick={() => runAction('assign', () => api.post(`/tasks/${task.id}/mes-assign`, {
                            assigned_to: assignOperatorId || null,
                            machine_id: assignMachineId || null,
                            use_ai_recommendation: assignWithAI,
                        }))}
                        className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                        disabled={busyKey === 'assign'}
                    >
                        {busyKey === 'assign' ? 'Assigning...' : 'Assign Job'}
                    </button>
                </SectionShell>
            )}

            {canOperate && ['assigned', 'setup', 'setup_done'].includes(task.status) && (
                <SectionShell title="Setup Verification">
                    <p className="text-xs text-text-secondary">Upload a setup image in the work-evidence section, then run the AI setup check.</p>
                    <button
                        type="button"
                        onClick={() => runAction('setup', () => api.post(`/tasks/${task.id}/ai-setup-check`))}
                        className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                        disabled={busyKey === 'setup'}
                    >
                        {busyKey === 'setup' ? 'Checking...' : 'Run AI Setup Check'}
                    </button>
                    {mesSummary?.setup_check && (
                        <div className="rounded-xl border border-border/60 bg-bg-hover/70 px-3 py-3 text-xs text-text-secondary">
                            Latest AI setup result: <span className="font-semibold text-text-primary">{mesSummary.setup_check.status}</span>
                        </div>
                    )}
                </SectionShell>
            )}

            {canOperate && ['setup_done', 'setup', 'first_piece_approval'].includes(task.status) && (
                <SectionShell title="First Piece Gate">
                    <select value={firstPieceStatus} onChange={(e) => setFirstPieceStatus(e.target.value)} className="input-glass w-full rounded-xl px-4 py-3 text-sm">
                        <option value="pass">Approve first piece</option>
                        <option value="fail">Reject and re-setup</option>
                    </select>
                    <textarea
                        value={firstPieceMeasurements}
                        onChange={(e) => setFirstPieceMeasurements(e.target.value)}
                        rows={3}
                        placeholder={'Length: 250 mm\nDia 1: 40 mm'}
                        className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                    />
                    <button
                        type="button"
                        onClick={() => runAction('first-piece', () => api.post(`/tasks/${task.id}/first-piece-review`, {
                            qc_status: firstPieceStatus,
                            measurements: parseMeasurements(firstPieceMeasurements),
                        }))}
                        className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                        disabled={busyKey === 'first-piece'}
                    >
                        {busyKey === 'first-piece' ? 'Submitting...' : 'Submit First Piece'}
                    </button>
                </SectionShell>
            )}

            {canOperate && ['in_progress', 'qc_check'].includes(task.status) && (
                <>
                    <SectionShell title="Production Log">
                        <div className="grid grid-cols-3 gap-2">
                            <input value={productionForm.produced_qty} onChange={(e) => setProductionForm((state) => ({ ...state, produced_qty: e.target.value }))} placeholder="Produced" className="input-glass rounded-xl px-3 py-3 text-sm" />
                            <input value={productionForm.rejected_qty} onChange={(e) => setProductionForm((state) => ({ ...state, rejected_qty: e.target.value }))} placeholder="Rejected" className="input-glass rounded-xl px-3 py-3 text-sm" />
                            <input value={productionForm.downtime_minutes} onChange={(e) => setProductionForm((state) => ({ ...state, downtime_minutes: e.target.value }))} placeholder="Downtime" className="input-glass rounded-xl px-3 py-3 text-sm" />
                        </div>
                        <textarea value={productionForm.notes} onChange={(e) => setProductionForm((state) => ({ ...state, notes: e.target.value }))} rows={2} placeholder="Downtime or rejection notes" className="input-glass w-full rounded-xl px-4 py-3 text-sm" />
                        <button
                            type="button"
                            onClick={() => runAction('production', () => api.post(`/tasks/${task.id}/production-log`, {
                                produced_qty: Number(productionForm.produced_qty || 0),
                                rejected_qty: Number(productionForm.rejected_qty || 0),
                                downtime_minutes: Number(productionForm.downtime_minutes || 0),
                                notes: productionForm.notes || null,
                            }))}
                            className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                            disabled={busyKey === 'production'}
                        >
                            {busyKey === 'production' ? 'Logging...' : 'Log Production'}
                        </button>
                    </SectionShell>

                    {canManage && (
                        <SectionShell title="In-Process QC">
                            <select value={qcStatus} onChange={(e) => setQcStatus(e.target.value)} className="input-glass w-full rounded-xl px-4 py-3 text-sm">
                                <option value="pass">Pass</option>
                                <option value="fail">Fail</option>
                                <option value="rework">Needs rework</option>
                            </select>
                            <textarea value={qcMeasurements} onChange={(e) => setQcMeasurements(e.target.value)} rows={3} placeholder={'Runout: 0.02 mm\nSurface roughness: 1.6 Ra'} className="input-glass w-full rounded-xl px-4 py-3 text-sm" />
                            <button
                                type="button"
                                onClick={() => runAction('qc', () => api.post(`/tasks/${task.id}/qc-report`, {
                                    qc_status: qcStatus,
                                    measurements: parseMeasurements(qcMeasurements),
                                    remarks: qcMeasurements || null,
                                }))}
                                className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                                disabled={busyKey === 'qc'}
                            >
                                {busyKey === 'qc' ? 'Submitting...' : 'Submit QC Report'}
                            </button>
                        </SectionShell>
                    )}

                    <SectionShell title="Final Inspection">
                        <p className="text-xs text-text-secondary">Upload final images in the work-evidence section, then run AI final inspection.</p>
                        <button
                            type="button"
                            onClick={() => runAction('final-ai', () => api.post(`/tasks/${task.id}/ai-final-inspection`))}
                            className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                            disabled={busyKey === 'final-ai'}
                        >
                            {busyKey === 'final-ai' ? 'Inspecting...' : 'Run AI Final Inspection'}
                        </button>
                    </SectionShell>
                </>
            )}

            {canManage && task.status === 'final_inspection' && (
                <>
                    <SectionShell title="Supervisor Decision">
                        <textarea value={finalRemarks} onChange={(e) => setFinalRemarks(e.target.value)} rows={3} placeholder="Approval or rework notes" className="input-glass w-full rounded-xl px-4 py-3 text-sm" />
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => runAction('approve', async () => {
                                    const response = await api.post(`/tasks/${task.id}/supervisor-final-decision`, { decision: 'approve', remarks: finalRemarks || null });
                                    setFinalApproved(true);
                                    return response;
                                })}
                                className="btn-primary rounded-xl px-4 py-3 text-xs font-semibold"
                                disabled={busyKey === 'approve'}
                            >
                                {busyKey === 'approve' ? 'Approving...' : 'Approve'}
                            </button>
                            <button
                                type="button"
                                onClick={() => runAction('rework', () => api.post(`/tasks/${task.id}/supervisor-final-decision`, { decision: 'rework', remarks: finalRemarks || null }))}
                                className="rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-xs font-semibold text-warning"
                                disabled={busyKey === 'rework'}
                            >
                                {busyKey === 'rework' ? 'Sending...' : 'Send to Rework'}
                            </button>
                        </div>
                    </SectionShell>

                    {(finalApproved || mesSummary?.dispatch) && (
                        <SectionShell title="Dispatch">
                            <input value={dispatchForm.invoice_number} onChange={(e) => setDispatchForm((state) => ({ ...state, invoice_number: e.target.value }))} placeholder="Invoice number" className="input-glass w-full rounded-xl px-4 py-3 text-sm" />
                            <textarea value={dispatchForm.packing_details} onChange={(e) => setDispatchForm((state) => ({ ...state, packing_details: e.target.value }))} rows={2} placeholder="Packing details" className="input-glass w-full rounded-xl px-4 py-3 text-sm" />
                            <textarea value={dispatchForm.transport_details} onChange={(e) => setDispatchForm((state) => ({ ...state, transport_details: e.target.value }))} rows={2} placeholder="Transport details" className="input-glass w-full rounded-xl px-4 py-3 text-sm" />
                            <button
                                type="button"
                                onClick={() => runAction('dispatch', () => api.post(`/tasks/${task.id}/dispatch`, dispatchForm))}
                                className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                                disabled={busyKey === 'dispatch'}
                            >
                                {busyKey === 'dispatch' ? 'Dispatching...' : 'Dispatch Job'}
                            </button>
                        </SectionShell>
                    )}
                </>
            )}

            {canManage && task.status === 'dispatched' && (
                <SectionShell title="Completion">
                    <button
                        type="button"
                        onClick={() => runAction('complete', async () => {
                            const data = await updateTaskStatus(task.id, 'completed');
                            return { task: data };
                        })}
                        className="btn-primary w-full rounded-xl px-4 py-3 text-xs font-semibold"
                        disabled={busyKey === 'complete'}
                    >
                        {busyKey === 'complete' ? 'Completing...' : 'Mark Completed'}
                    </button>
                </SectionShell>
            )}
        </div>
    );
}
