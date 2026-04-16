/**
 * JobCreationModal — Multi-step CNC job creation wizard for owners and supervisors.
 *
 * Steps:
 *   1. Client Selection (existing or create new inline)
 *   2. Part Details (name, material, machine, priority)
 *   3. Drawing Upload + AI Extraction → AI+Human Validation Table
 *   4. Verify & Lock
 */

import { useState, useEffect } from 'react';
import useAppStore from '../stores/appStore';
import api from '../api/client';

const STEPS = [
    { id: 1, label: 'Client', icon: '👤' },
    { id: 2, label: 'Part Details', icon: '⚙️' },
    { id: 3, label: 'AI Specs', icon: '🧠' },
    { id: 4, label: 'Lock', icon: '🔒' },
];

const MATERIAL_OPTIONS = ['EN8', 'EN9', 'EN24', 'SS304', 'SS316', 'MS', 'Mild Steel', 'Cast Iron', 'Alloy Steel', 'Aluminium 6061', 'Other'];
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'critical'];

function resolveMediaUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/api\/v1\/?$/, '');
    return apiBase ? `${apiBase}${path}` : path;
}

export default function JobCreationModal() {
    const {
        isJobCreationModalOpen, closeJobCreationModal,
        clients, fetchClients, machines, fetchMachines,
        createCNCJob, createClient,
        extractJobSpecs, updateJobSpec, confirmAllSpecs, lockJob,
        fetchJobSpecs,
        creatingTask, lockingJob,
        aiProviderStatus, fetchAIProviderStatus,
        addAlert,
    } = useAppStore();

    const [step, setStep] = useState(1);
    const [error, setError] = useState('');
    const [taskId, setTaskId] = useState(null);

    // Step 1: Client
    const [clientMode, setClientMode] = useState('existing'); // 'existing' | 'new'
    const [selectedClientId, setSelectedClientId] = useState('');
    const [newClient, setNewClient] = useState({
        company_name: '',
        contact_person: '',
        email: '',
        phone: '',
        address: '',
        send_email: true,
    });
    const [createdClientCreds, setCreatedClientCreds] = useState(null);

    // Step 2: Part details
    const [partName, setPartName] = useState('');
    const [materialType, setMaterialType] = useState('');
    const [materialBatch, setMaterialBatch] = useState('');
    const [selectedMachineId, setSelectedMachineId] = useState('');
    const [priority, setPriority] = useState('medium');
    const [description, setDescription] = useState('');

    // Step 3: AI specs
    const [drawingContext, setDrawingContext] = useState('');
    const [drawingFile, setDrawingFile] = useState(null);
    const [drawingUploadedUrl, setDrawingUploadedUrl] = useState('');
    const [drawingUploading, setDrawingUploading] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [specs, setSpecs] = useState([]);
    const [editedSpecs, setEditedSpecs] = useState({}); // { [specId]: humanValue }
    const [extractionMessage, setExtractionMessage] = useState('');
    const [validationSummary, setValidationSummary] = useState(null);
    const [confirming, setConfirming] = useState(false);

    // Step 4: Lock
    const [locking, setLocking] = useState(false);

    useEffect(() => {
        if (isJobCreationModalOpen) {
            fetchClients();
            fetchMachines();
            fetchAIProviderStatus();
            resetState();
        }
    }, [isJobCreationModalOpen, fetchAIProviderStatus]);

    const resetState = () => {
        setStep(1); setError(''); setTaskId(null);
        setClientMode('existing'); setSelectedClientId(''); setNewClient({
            company_name: '',
            contact_person: '',
            email: '',
            phone: '',
            address: '',
            send_email: true,
        });
        setCreatedClientCreds(null);
        setPartName(''); setMaterialType(''); setMaterialBatch(''); setSelectedMachineId(''); setPriority('medium'); setDescription('');
        setDrawingContext(''); setDrawingFile(null); setDrawingUploadedUrl(''); setDrawingUploading(false); setExtracting(false); setSpecs([]); setEditedSpecs({}); setExtractionMessage(''); setValidationSummary(null); setConfirming(false); setLocking(false);
    };

    if (!isJobCreationModalOpen) return null;

    // ── Step navigation ──────────────────────────────────────

    const goToStep = async (target) => {
        setError('');
        if (target === 2) {
            if (clientMode === 'existing' && !selectedClientId) {
                setError('Please select a client or create a new one.');
                return;
            }
            if (clientMode === 'new') {
                if (!newClient.company_name.trim()) { setError('Client company name is required.'); return; }
                if (!newClient.contact_person.trim()) { setError('Client contact person is required.'); return; }
                if (!newClient.email.trim()) { setError('Client email is required.'); return; }
                // Create the new client
                try {
                    const creds = await createClient({
                        company_name: newClient.company_name,
                        contact_person: newClient.contact_person,
                        email: newClient.email,
                        phone: newClient.phone || null,
                        address: newClient.address || null,
                        send_email: newClient.send_email,
                    });
                    setCreatedClientCreds(creds);
                    setSelectedClientId(creds.id);
                    addAlert(`Client "${creds.company_name}" created. Credentials ready.`, 'success');
                } catch (e) {
                    setError(e.message);
                    return;
                }
            }
        }
        if (target === 3) {
            if (!partName.trim()) { setError('Part name is required.'); return; }

            // Create the CNC job if not created yet
            if (!taskId) {
                try {
                    const job = await createCNCJob({
                        title: partName,
                        description: description || null,
                        priority,
                        client_id: selectedClientId || null,
                        machine_id: selectedMachineId || null,
                        part_name: partName,
                        material_type: materialType || null,
                        material_batch: materialBatch || null,
                    });
                    setTaskId(job.id);
                } catch (e) {
                    setError(e.message);
                    return;
                }
            }
        }
        if (target === 4) {
            // Load current specs
            if (taskId) {
                const specData = await fetchJobSpecs(taskId);
                if (specData) setSpecs(specData.specs || []);
            }
        }
        setStep(target);
    };

    const handleDrawingUpload = async (file) => {
        if (!file || !taskId) return;
        setDrawingUploading(true);
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const { data } = await api.post(`/uploads/tasks/${taskId}/media`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const mediaUrl = data.media_url || data.image_url || '';
            await api.patch(`/tasks/${taskId}/cnc-fields`, { drawing_url: mediaUrl });
            setDrawingUploadedUrl(mediaUrl);
            addAlert('Drawing uploaded and linked to the job.', 'success');
        } catch (e) {
            setError(e.response?.data?.detail || e.message || 'Unable to upload the drawing.');
        } finally {
            setDrawingUploading(false);
        }
    };

    const handleExtract = async () => {
        if (!taskId) return;
        if (!drawingUploadedUrl && !drawingContext.trim()) {
            setError('Upload a drawing image or paste drawing details before AI extraction.');
            return;
        }
        if (drawingUploadedUrl && !drawingContext.trim() && aiProviderStatus?.vision_enabled !== true) {
            setError(
                aiProviderStatus?.enabled
                    ? 'Image OCR needs OPENROUTER_MODEL_VISION. Paste drawing text or add a vision-capable OpenRouter model.'
                    : 'Image OCR needs OPENROUTER_API_KEY and OPENROUTER_MODEL_VISION. Paste drawing text or configure AI first.'
            );
            return;
        }
        setExtracting(true);
        setError('');
        try {
            const result = await extractJobSpecs(taskId, {
                drawing_context: drawingContext || null,
                drawing_image_url: resolveMediaUrl(drawingUploadedUrl),
                part_name: partName,
            });
            if (result?.specs) setSpecs(result.specs);
            setEditedSpecs({});
            setExtractionMessage(result?.message || '');
            setValidationSummary(result?.validation_summary || null);
        } catch (e) {
            setError(e.message);
        } finally {
            setExtracting(false);
        }
    };

    const handleSpecEdit = (spec, value) => {
        setEditedSpecs((p) => ({ ...p, [spec.id]: value }));
        // Optimistic update
        setSpecs((prev) => prev.map((s) => s.id === spec.id ? { ...s, human_value: value } : s));
    };

    const handleConfirmAll = async () => {
        const hasBlockingInvalidSpecs = specs.some((spec) => {
            const isInvalid = spec.review_status ? spec.review_status === 'invalid' : (spec.ai_confidence || 0) < 0.7;
            if (!isInvalid) {
                return false;
            }
            const currentValue = (editedSpecs[spec.id] ?? spec.human_value ?? '').trim();
            return !currentValue;
        });
        if (hasBlockingInvalidSpecs) {
            setError('Invalid OCR rows need a typed human value before you can confirm and lock the job.');
            return;
        }

        setConfirming(true);
        try {
            // Save any pending edits first
            for (const [specId, value] of Object.entries(editedSpecs)) {
                await updateJobSpec(specId, { human_value: value, is_confirmed: true });
            }
            await confirmAllSpecs(taskId);
            const specData = await fetchJobSpecs(taskId);
            if (specData) setSpecs(specData.specs || []);
            setEditedSpecs({});
            setStep(4);
        } catch (e) {
            setError(e.message);
        } finally {
            setConfirming(false);
        }
    };

    const hasBlockingInvalidSpecs = specs.some((spec) => {
        const isInvalid = spec.review_status ? spec.review_status === 'invalid' : (spec.ai_confidence || 0) < 0.7;
        if (!isInvalid) {
            return false;
        }
        const currentValue = (editedSpecs[spec.id] ?? spec.human_value ?? '').trim();
        return !currentValue;
    });

    const handleLock = async () => {
        setLocking(true);
        setError('');
        try {
            await lockJob(taskId);
            addAlert('Job locked! Now configure the process plan.', 'success');
            closeJobCreationModal();
        } catch (e) {
            setError(e.message);
        } finally {
            setLocking(false);
        }
    };

    return (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-bg-overlay px-4 py-8">
            <div className="modal-shell flex max-h-[92vh] w-full max-w-[700px] flex-col overflow-hidden rounded-[30px] shadow-2xl">
                {/* ── Header ─────────────────────────────── */}
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/70 px-6 py-5">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">CNC MES</p>
                        <h2 className="font-display mt-2 text-3xl tracking-tight text-text-primary">Create CNC Job</h2>
                        <p className="mt-2 text-xs leading-6 text-text-secondary">
                            Locked job creation with client linking, drawing extraction, human verification, and release control.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={closeJobCreationModal}
                        className="modal-close"
                    >
                        Close
                    </button>
                </div>

                {/* ── Step Indicator ──────────────────────── */}
                <div className="flex shrink-0 gap-2 border-b border-border/70 px-6 py-4">
                    {STEPS.map((s, idx) => {
                        const isActive = s.id === step;
                        const isDone = s.id < step;
                        return (
                            <div key={s.id} className="flex flex-1 items-center gap-2">
                                <div
                                    className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 ${
                                        isActive
                                            ? 'border-accent/30 bg-accent/10 text-accent'
                                            : isDone
                                                ? 'border-success/25 bg-success/10 text-success'
                                                : 'border-border/70 bg-bg-hover/40 text-text-muted'
                                    }`}
                                >
                                    <span className="text-sm">{isDone ? '✓' : s.icon}</span>
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                                        {s.label}
                                    </span>
                                </div>
                                {idx < STEPS.length - 1 && (
                                    <div className={`hidden h-px flex-1 rounded-full md:block ${isDone ? 'bg-success/40' : 'bg-border/80'}`} />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* ── Body ─────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto px-6 py-5">
                    {/* Error banner */}
                    {error && (
                        <div className="mb-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger">
                            {error}
                        </div>
                    )}

                    {/* ─── STEP 1: Client ─── */}
                    {step === 1 && (
                        <StepClient
                            clientMode={clientMode} setClientMode={setClientMode}
                            selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId}
                            newClient={newClient} setNewClient={setNewClient}
                            clients={clients} createdClientCreds={createdClientCreds}
                        />
                    )}

                    {/* ─── STEP 2: Part Details ─── */}
                    {step === 2 && (
                        <StepPartDetails
                            partName={partName} setPartName={setPartName}
                            materialType={materialType} setMaterialType={setMaterialType}
                            materialBatch={materialBatch} setMaterialBatch={setMaterialBatch}
                            selectedMachineId={selectedMachineId} setSelectedMachineId={setSelectedMachineId}
                            priority={priority} setPriority={setPriority}
                            description={description} setDescription={setDescription}
                            machines={machines}
                        />
                    )}

                    {/* ─── STEP 3: AI Specs ─── */}
                    {step === 3 && (
                        <StepAISpecs
                            drawingContext={drawingContext} setDrawingContext={setDrawingContext}
                            drawingFile={drawingFile} setDrawingFile={setDrawingFile}
                            drawingUploadedUrl={drawingUploadedUrl}
                            drawingUploading={drawingUploading}
                            onDrawingUpload={handleDrawingUpload}
                            specs={specs} onExtract={handleExtract} extracting={extracting}
                            onSpecEdit={handleSpecEdit}
                            editedSpecs={editedSpecs}
                            extractionMessage={extractionMessage}
                            validationSummary={validationSummary}
                            partName={partName}
                            aiProviderStatus={aiProviderStatus}
                        />
                    )}

                    {/* ─── STEP 4: Verify & Lock ─── */}
                    {step === 4 && (
                        <StepVerifyLock
                            specs={specs} taskId={taskId}
                            partName={partName} materialType={materialType}
                            priority={priority}
                        />
                    )}
                </div>

                {/* ── Footer Actions ──────────────────────── */}
                <div className="flex shrink-0 justify-between gap-3 border-t border-border/70 px-6 py-4">
                    <button
                        type="button"
                        onClick={() => step > 1 ? setStep(step - 1) : closeJobCreationModal()}
                        className="btn-ghost rounded-xl px-4 py-3 text-sm font-medium"
                    >
                        {step === 1 ? 'Cancel' : 'Back'}
                    </button>

                    <div className="flex flex-wrap justify-end gap-2">
                        {step === 3 && specs.length > 0 && (
                            <button
                                type="button"
                                onClick={handleConfirmAll}
                                disabled={confirming || hasBlockingInvalidSpecs}
                                className="rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-sm font-semibold text-success disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {confirming ? 'Confirming...' : hasBlockingInvalidSpecs ? 'Resolve Invalid Fields' : 'Review Complete & Continue'}
                            </button>
                        )}
                        {step < 3 && (
                            <button
                                type="button"
                                onClick={() => goToStep(step + 1)}
                                disabled={creatingTask}
                                className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {creatingTask ? 'Creating...' : 'Continue'}
                            </button>
                        )}
                        {step === 3 && specs.length === 0 && (
                            <button
                                type="button"
                                onClick={handleExtract}
                                disabled={extracting}
                                className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {extracting ? 'Extracting...' : 'Extract Specs'}
                            </button>
                        )}
                        {step === 4 && (
                            <button
                                type="button"
                                onClick={handleLock}
                                disabled={locking || lockingJob}
                                className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {(locking || lockingJob) ? 'Locking...' : 'Verify & Lock Job'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}


// ──────────────────────────────────────────────────────────
// Sub-step components
// ──────────────────────────────────────────────────────────

function StepClient({ clientMode, setClientMode, selectedClientId, setSelectedClientId, newClient, setNewClient, clients, createdClientCreds }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)',  marginBottom: '4px' }}>
                Associate this job with a client for progress visibility and portal access.
            </div>

            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: '8px' }}>
                {[{ id: 'existing', label: '📋 Existing Client' }, { id: 'new', label: '➕ New Client' }].map((m) => (
                    <button
                        key={m.id}
                        onClick={() => setClientMode(m.id)}
                        style={{
                            flex: 1, padding: '10px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                            background: clientMode === m.id ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${clientMode === m.id ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
                            color: clientMode === m.id ? '#A5B4FC' : 'var(--text-muted)',
                            cursor: 'pointer',
                        }}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {clientMode === 'existing' && (
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                        SELECT CLIENT *
                    </label>
                    {clients.length === 0 ? (
                        <div style={{
                            padding: '16px', borderRadius: '10px', textAlign: 'center',
                            background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)',
                            fontSize: '12px', color: 'var(--text-muted)',
                        }}>
                            No clients found. Switch to "New Client" to create one.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {clients.map((client) => (
                                <div
                                    key={client.id}
                                    onClick={() => setSelectedClientId(client.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '12px',
                                        padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
                                        background: selectedClientId === client.id ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.02)',
                                        border: `1px solid ${selectedClientId === client.id ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)'}`,
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    <div style={{
                                        width: '36px', height: '36px', borderRadius: '50%',
                                        background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '14px', fontWeight: 700, color: 'white', flexShrink: 0,
                                    }}>
                                        {client.company_name?.[0]?.toUpperCase() || client.contact_person?.[0]?.toUpperCase() || '?'}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{client.company_name}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            {client.contact_person} • {client.email}
                                        </div>
                                    </div>
                                    {selectedClientId === client.id && (
                                        <span style={{ marginLeft: 'auto', color: '#34D399', fontSize: '16px' }}>✓</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {clientMode === 'new' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {createdClientCreds && (
                        <div style={{
                            padding: '12px 16px', borderRadius: '10px',
                            background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)',
                        }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#34D399', marginBottom: '8px' }}>
                                ✅ Client created! Share these credentials:
                            </div>
                            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-primary)' }}>
                                <div>Client ID: {createdClientCreds.client_id}</div>
                                <div>Username: {createdClientCreds.username}</div>
                                <div>Temp Password: <strong>{createdClientCreds.temp_password}</strong></div>
                            </div>
                            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '6px' }}>
                                Client must change password on first login.
                            </div>
                            <button
                                type="button"
                                onClick={() => navigator.clipboard.writeText(`Client ID: ${createdClientCreds.client_id}\nUsername: ${createdClientCreds.username}\nTemp Password: ${createdClientCreds.temp_password}`)}
                                style={{
                                    marginTop: '10px',
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(52,211,153,0.3)',
                                    background: 'rgba(52,211,153,0.15)',
                                    color: '#34D399',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                Copy Credentials
                            </button>
                        </div>
                    )}
                    <FormField label="Company Name *" value={newClient.company_name} onChange={(v) => setNewClient((p) => ({ ...p, company_name: v }))} placeholder="Acme Motion Pvt Ltd" />
                    <FormField label="Contact Person *" value={newClient.contact_person} onChange={(v) => setNewClient((p) => ({ ...p, contact_person: v }))} placeholder="Riya Shah" />
                    <FormField label="Email *" type="email" value={newClient.email} onChange={(v) => setNewClient((p) => ({ ...p, email: v }))} placeholder="client@company.com" />
                    <FormField label="Phone" value={newClient.phone} onChange={(v) => setNewClient((p) => ({ ...p, phone: v }))} placeholder="+91 9876543210" />
                    <FormField label="Address" value={newClient.address} onChange={(v) => setNewClient((p) => ({ ...p, address: v }))} placeholder="Plant / billing address" multiline />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        <input
                            type="checkbox"
                            checked={newClient.send_email}
                            onChange={(e) => setNewClient((p) => ({ ...p, send_email: e.target.checked }))}
                        />
                        Email credentials automatically after creation
                    </label>
                </div>
            )}
        </div>
    );
}

function StepPartDetails({ partName, setPartName, materialType, setMaterialType, materialBatch, setMaterialBatch, selectedMachineId, setSelectedMachineId, priority, setPriority, description, setDescription, machines }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FormField label="Part Name / Job Title *" value={partName} onChange={setPartName} placeholder="e.g. CNC Shaft Step-3, Drive Shaft φ60" />
            <FormField label="Description" value={description} onChange={setDescription} placeholder="Brief job description (optional)" multiline />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', fontWeight: 600, letterSpacing: '0.03em' }}>MATERIAL TYPE</label>
                    <select value={materialType} onChange={(e) => setMaterialType(e.target.value)} className="input-glass" style={{ width: '100%', cursor: 'pointer' }}>
                        <option value="">Select material…</option>
                        {MATERIAL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <FormField label="Material Batch No." value={materialBatch} onChange={setMaterialBatch} placeholder="e.g. BT-2024-007" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', fontWeight: 600, letterSpacing: '0.03em' }}>MACHINE (OPTIONAL)</label>
                    <select value={selectedMachineId} onChange={(e) => setSelectedMachineId(e.target.value)} className="input-glass" style={{ width: '100%', cursor: 'pointer' }}>
                        <option value="">Assign later…</option>
                        {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                </div>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', fontWeight: 600, letterSpacing: '0.03em' }}>PRIORITY</label>
                    <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-glass" style={{ width: '100%', cursor: 'pointer' }}>
                        {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                    </select>
                </div>
            </div>
        </div>
    );
}

function StepAISpecs({
    drawingContext,
    setDrawingContext,
    drawingFile,
    setDrawingFile,
    drawingUploadedUrl,
    drawingUploading,
    onDrawingUpload,
    specs,
    onExtract,
    extracting,
    onSpecEdit,
    editedSpecs,
    extractionMessage,
    validationSummary,
    partName,
    aiProviderStatus,
}) {
    const getReviewMeta = (spec) => {
        const status = spec.review_status || ((spec.ai_confidence || 0) >= 0.9 ? 'high_confidence' : (spec.ai_confidence || 0) >= 0.7 ? 'needs_review' : 'invalid');
        if (status === 'high_confidence') {
            return {
                label: 'High Confidence',
                tone: 'border-success/25 bg-success/10 text-success',
                rowTone: 'border-success/10 bg-success/5',
                hint: 'Auto-filled from explicit drawing text',
            };
        }
        if (status === 'needs_review') {
            return {
                label: 'Needs Review',
                tone: 'border-warning/25 bg-warning/10 text-warning',
                rowTone: 'border-warning/10 bg-warning/5',
                hint: 'Check against the drawing before lock',
            };
        }
        return {
            label: 'Invalid',
            tone: 'border-danger/25 bg-danger/10 text-danger',
            rowTone: 'border-danger/15 bg-danger/5',
            hint: 'Type a verified human value to continue',
        };
    };

    const getHumanValue = (spec) => {
        const isInvalid = spec.review_status ? spec.review_status === 'invalid' : (spec.ai_confidence || 0) < 0.7;
        if (editedSpecs[spec.id] !== undefined) {
            return editedSpecs[spec.id];
        }
        if (isInvalid) {
            return spec.human_value || '';
        }
        return spec.human_value || spec.ai_value || '';
    };

    const reviewCounts = validationSummary?.review_counts || specs.reduce((counts, spec) => {
        const status = spec.review_status || ((spec.ai_confidence || 0) >= 0.9 ? 'high_confidence' : (spec.ai_confidence || 0) >= 0.7 ? 'needs_review' : 'invalid');
        if (status === 'high_confidence') counts.high_confidence += 1;
        else if (status === 'needs_review') counts.medium_review += 1;
        else counts.invalid += 1;
        return counts;
    }, { high_confidence: 0, medium_review: 0, invalid: 0 });

    const rejectedCount = validationSummary?.rejected_fields?.length || 0;
    const acceptedCount = validationSummary?.accepted_fields?.length || Math.max(0, specs.length - reviewCounts.invalid);

    const confidenceLabel = (confidence) => {
        if (confidence === null || confidence === undefined) return 'No score';
        return `${Math.round(confidence * 100)}%`;
    };
    const aiReady = aiProviderStatus?.enabled === true;
    const visionReady = aiProviderStatus?.vision_enabled === true;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className={`rounded-2xl border px-4 py-4 ${visionReady ? 'border-success/20 bg-success/6' : aiReady ? 'border-warning/20 bg-warning/6' : 'border-danger/20 bg-danger/6'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className={`text-xs font-bold uppercase tracking-[0.18em] ${visionReady ? 'text-success' : aiReady ? 'text-warning' : 'text-danger'}`}>
                            {visionReady ? 'Vision Extraction Ready' : aiReady ? 'Text AI Ready' : 'Manual Assist Mode'}
                        </div>
                        <p className="mt-2 text-xs leading-6 text-text-secondary">
                            {visionReady
                                ? 'Uploaded drawings will be sent to the configured OpenRouter vision model, with text parsing as backup.'
                                : aiReady
                                    ? 'OpenRouter is connected, but image OCR needs OPENROUTER_MODEL_VISION. Pasted drawing text will still extract accurately.'
                                    : 'No OpenRouter key is configured. Uploads are stored, but accurate extraction will rely on pasted drawing text and manual verification.'}
                        </p>
                    </div>
                    <div className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${visionReady ? 'border-success/25 bg-success/10 text-success' : aiReady ? 'border-warning/25 bg-warning/10 text-warning' : 'border-danger/25 bg-danger/10 text-danger'}`}>
                        {visionReady ? 'Image + Text' : aiReady ? 'Text + AI' : 'Manual + Parser'}
                    </div>
                </div>
            </div>

            <div className="glass-card rounded-2xl border border-border/70 p-4">
                <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
                    Drawing Upload
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setDrawingFile(file);
                        }}
                        className="input-glass"
                        style={{ flex: 1, minWidth: '220px' }}
                    />
                    <button
                        type="button"
                        onClick={() => drawingFile && onDrawingUpload(drawingFile)}
                        disabled={!drawingFile || drawingUploading}
                        className="btn-primary rounded-xl px-4 py-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {drawingUploading ? 'Uploading...' : 'Upload Drawing'}
                    </button>
                </div>
                <div className={`mt-3 text-[11px] ${drawingUploadedUrl ? 'text-success' : 'text-text-muted'}`}>
                    {drawingUploadedUrl
                        ? 'Drawing linked to this job and ready for extraction.'
                        : 'Upload a drawing image, or provide detailed drawing text below.'}
                </div>
            </div>

            {/* Drawing context input */}
            <div className="glass-card rounded-2xl border border-border/70 p-4">
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', fontWeight: 600, letterSpacing: '0.03em' }}>
                    DRAWING TEXT / OCR <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>(Optional but strongly recommended)</span>
                </label>
                <textarea
                    value={drawingContext}
                    onChange={(e) => setDrawingContext(e.target.value)}
                    placeholder={`Paste drawing text, dimensions, or part description here...\n\nExample: "Overall length 450mm, OD1: 60mm, OD2: 45mm, OD3: 35mm, Thread M30x2, Keyway 12mm wide, Surface roughness Ra 1.6, Runout 0.02mm"`}
                    className="input-glass"
                    style={{ width: '100%', minHeight: '100px', resize: 'vertical', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.6, boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    If OCR is unavailable, this text parser is the most accurate extraction path for "{partName}". You can still edit every field before locking.
                </div>
            </div>

            {/* Specs table */}
            {specs.length > 0 ? (
                <div className="space-y-4">
                    {extractionMessage && (
                        <div className="glass-card rounded-2xl border border-accent/20 px-4 py-3 text-xs leading-6 text-text-secondary">
                            {extractionMessage}
                        </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-4">
                        <div className="glass-card rounded-2xl border border-success/20 px-4 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-success">High Confidence</p>
                            <p className="mt-2 text-2xl font-display text-text-primary">{reviewCounts.high_confidence || 0}</p>
                            <p className="mt-1 text-[11px] text-text-secondary">Ready to verify quickly</p>
                        </div>
                        <div className="glass-card rounded-2xl border border-warning/20 px-4 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-warning">Needs Review</p>
                            <p className="mt-2 text-2xl font-display text-text-primary">{reviewCounts.medium_review || 0}</p>
                            <p className="mt-1 text-[11px] text-text-secondary">Cross-check before lock</p>
                        </div>
                        <div className="glass-card rounded-2xl border border-danger/20 px-4 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-danger">Invalid</p>
                            <p className="mt-2 text-2xl font-display text-text-primary">{reviewCounts.invalid || 0}</p>
                            <p className="mt-1 text-[11px] text-text-secondary">Typed human value required</p>
                        </div>
                        <div className="glass-card rounded-2xl border border-border/70 px-4 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">Parser Result</p>
                            <p className="mt-2 text-2xl font-display text-text-primary">{acceptedCount}</p>
                            <p className="mt-1 text-[11px] text-text-secondary">
                                {rejectedCount ? `${rejectedCount} values rejected by validation` : 'No rejected values'}
                            </p>
                        </div>
                    </div>

                    <div className="glass-card rounded-2xl border border-border/70 p-4">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
                                    AI + Human Validation Table
                                </div>
                                <p className="mt-2 text-xs leading-6 text-text-secondary">
                                    Green rows can flow through. Amber rows should be checked against the drawing. Red rows must be typed manually before confirmation.
                                </p>
                            </div>
                            <span className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                                {specs.filter((s) => s.is_confirmed).length}/{specs.length} Confirmed
                            </span>
                        </div>

                        <div className="grid grid-cols-[1.7fr_1.2fr_1fr_1.5fr] gap-3 rounded-t-2xl border border-border/70 bg-bg-hover/40 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-text-secondary">
                            <div>Parameter</div>
                            <div>AI Value</div>
                            <div>Status</div>
                            <div>Human Value</div>
                        </div>

                        <div className="overflow-hidden rounded-b-2xl border border-t-0 border-border/70">
                            {specs.map((spec, idx) => {
                                const reviewMeta = getReviewMeta(spec);
                                const currentValue = getHumanValue(spec);
                                const requiresHumanValue = reviewMeta.label === 'Invalid';

                                return (
                                    <div
                                        key={spec.id}
                                        className={`grid grid-cols-[1.7fr_1.2fr_1fr_1.5fr] gap-3 px-4 py-3 ${reviewMeta.rowTone} ${idx < specs.length - 1 ? 'border-b border-border/50' : ''}`}
                                    >
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold text-text-primary">
                                                {spec.field_name.replace(/_/g, ' ')}
                                            </div>
                                            <div className="mt-1 text-[11px] text-text-muted">
                                                {spec.unit ? `Unit: ${spec.unit}` : 'Unitless value'}
                                            </div>
                                        </div>

                                        <div className="min-w-0 font-mono text-xs text-text-secondary">
                                            <div>{spec.ai_value || '—'}</div>
                                            <div className="mt-1 text-[11px] text-text-muted">{confidenceLabel(spec.ai_confidence)}</div>
                                        </div>

                                        <div className="min-w-0">
                                            <div className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${reviewMeta.tone}`}>
                                                {reviewMeta.label}
                                            </div>
                                            <div className="mt-2 text-[11px] leading-5 text-text-muted">
                                                {reviewMeta.hint}
                                            </div>
                                        </div>

                                        <div className="min-w-0">
                                            <input
                                                type="text"
                                                value={currentValue}
                                                onChange={(e) => onSpecEdit(spec, e.target.value)}
                                                placeholder={requiresHumanValue ? 'Type verified value' : (spec.ai_value || 'Enter value')}
                                                className="input-glass w-full rounded-xl px-3 py-2 text-xs font-mono"
                                                style={{
                                                    background: spec.is_confirmed ? 'rgba(52,211,153,0.08)' : requiresHumanValue ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.05)',
                                                    borderColor: spec.is_confirmed ? 'rgba(52,211,153,0.28)' : requiresHumanValue ? 'rgba(248,113,113,0.24)' : 'rgba(255,255,255,0.1)',
                                                }}
                                            />
                                            {requiresHumanValue && !currentValue.trim() && (
                                                <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-danger">
                                                    Required before confirmation
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-4 text-[11px] leading-6 text-text-secondary">
                            Human verification stays mandatory for every row. Invalid OCR rows are blocked until you enter a verified value.
                        </div>
                    </div>
                </div>
            ) : (
                <div className="rounded-2xl border border-dashed border-accent/20 bg-accent/5 px-6 py-10 text-center">
                    <div style={{ fontSize: '32px', marginBottom: '10px' }}>🧠</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                        Ready to Extract Specs
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '300px', margin: '0 auto' }}>
                        Upload the drawing, paste any readable text you have, and extract the spec table before human verification.
                    </div>
                </div>
            )}
        </div>
    );
}

function StepVerifyLock({ specs, taskId, partName, materialType, priority }) {
    const confirmedCount = specs.filter((s) => s.is_confirmed).length;
    const allConfirmed = confirmedCount === specs.length && specs.length > 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{
                padding: '16px', borderRadius: '12px',
                background: allConfirmed ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)',
                border: `1px solid ${allConfirmed ? 'rgba(52,211,153,0.2)' : 'rgba(251,191,36,0.2)'}`,
            }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: allConfirmed ? '#34D399' : '#FBBF24', marginBottom: '8px' }}>
                    {allConfirmed ? '✅ All specs confirmed — ready to lock' : '⚠️ Some specs not confirmed yet'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {confirmedCount} / {specs.length} specifications confirmed
                </div>
            </div>

            {/* Summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <SummaryRow icon="📋" label="Part Name" value={partName} />
                <SummaryRow icon="🔩" label="Material" value={materialType || 'Not specified'} />
                <SummaryRow icon="🎯" label="Priority" value={priority?.toUpperCase()} />
                <SummaryRow icon="📏" label="Specs Confirmed" value={`${confirmedCount} / ${specs.length} fields`} />
            </div>

            {/* Lock warning */}
            <div style={{
                padding: '14px', borderRadius: '10px',
                background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
            }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#A5B4FC', marginBottom: '6px' }}>
                    🔒 What happens when you lock:
                </div>
                <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                    <li>Job specifications become read-only</li>
                    <li>AI cannot override confirmed values</li>
                    <li>Process planning becomes available</li>
                    <li>Job status moves to "Created"</li>
                    <li>Client portal shows "Order Received"</li>
                </ul>
            </div>
        </div>
    );
}

function SummaryRow({ icon, label, value }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', flex: 1 }}>{label}</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{value}</span>
        </div>
    );
}

function FormField({ label, value, onChange, placeholder, type = 'text', multiline = false }) {
    const style = {
        width: '100%', padding: '10px 12px', boxSizing: 'border-box',
        borderRadius: '8px', background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)', color: 'var(--text-primary)',
        fontSize: '13px', outline: 'none',
        transition: 'border-color 0.2s',
    };
    return (
        <div>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', fontWeight: 600, letterSpacing: '0.03em' }}>
                {label}
            </label>
            {multiline ? (
                <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...style, minHeight: '64px', resize: 'vertical', lineHeight: 1.5 }} />
            ) : (
                <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={style} className="input-glass" />
            )}
        </div>
    );
}
