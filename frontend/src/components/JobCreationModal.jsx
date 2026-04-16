/**
 * JobCreationModal — Multi-step CNC job creation wizard for supervisors.
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

export default function JobCreationModal() {
    const {
        isJobCreationModalOpen, closeJobCreationModal,
        clients, fetchClients, machines, fetchMachines,
        createCNCJob, createClient,
        extractJobSpecs, updateJobSpec, confirmAllSpecs, lockJob,
        fetchJobSpecs,
        creatingTask, lockingJob,
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
    const [confirming, setConfirming] = useState(false);

    // Step 4: Lock
    const [locking, setLocking] = useState(false);

    useEffect(() => {
        if (isJobCreationModalOpen) {
            fetchClients();
            fetchMachines();
            resetState();
        }
    }, [isJobCreationModalOpen]);

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
        setDrawingContext(''); setDrawingFile(null); setDrawingUploadedUrl(''); setSpecs([]); setEditedSpecs({}); setLocking(false);
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
        setExtracting(true);
        setError('');
        try {
            const result = await extractJobSpecs(taskId, {
                drawing_context: drawingContext || null,
                part_name: partName,
            });
            if (result?.specs) setSpecs(result.specs);
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
        setConfirming(true);
        try {
            // Save any pending edits first
            for (const [specId, value] of Object.entries(editedSpecs)) {
                await updateJobSpec(specId, { human_value: value, is_confirmed: true });
            }
            await confirmAllSpecs(taskId);
            const specData = await fetchJobSpecs(taskId);
            if (specData) setSpecs(specData.specs || []);
            setStep(4);
        } catch (e) {
            setError(e.message);
        } finally {
            setConfirming(false);
        }
    };

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
        <div className="modal-backdrop" style={{ zIndex: 2000 }}>
            <div className="modal-shell" style={{
                width: 'min(700px, 95vw)',
                maxHeight: '92vh',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
            }}>
                {/* ── Header ─────────────────────────────── */}
                <div style={{
                    padding: '20px 24px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                            Create CNC Job
                        </h2>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            AI-assisted job creation with drawing extraction & verification
                        </div>
                    </div>
                    <button
                        onClick={closeJobCreationModal}
                        style={{
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '8px', color: 'var(--text-muted)',
                            width: '32px', height: '32px', fontSize: '18px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >×</button>
                </div>

                {/* ── Step Indicator ──────────────────────── */}
                <div style={{
                    padding: '14px 24px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', gap: '4px', flexShrink: 0,
                }}>
                    {STEPS.map((s, idx) => {
                        const isActive = s.id === step;
                        const isDone = s.id < step;
                        return (
                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: 1, gap: '4px' }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '6px', flex: 1,
                                    padding: '6px 10px', borderRadius: '8px',
                                    background: isActive ? 'rgba(99,102,241,0.15)' : isDone ? 'rgba(52,211,153,0.08)' : 'transparent',
                                    border: `1px solid ${isActive ? 'rgba(99,102,241,0.3)' : isDone ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)'}`,
                                }}>
                                    <span style={{ fontSize: '14px' }}>{isDone ? '✓' : s.icon}</span>
                                    <span style={{
                                        fontSize: '11px', fontWeight: 600,
                                        color: isActive ? '#A5B4FC' : isDone ? '#34D399' : 'var(--text-muted)',
                                    }}>
                                        {s.label}
                                    </span>
                                </div>
                                {idx < STEPS.length - 1 && (
                                    <div style={{
                                        width: '16px', height: '1px', flexShrink: 0,
                                        background: isDone ? '#34D399' : 'rgba(255,255,255,0.08)',
                                    }} />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* ── Body ─────────────────────────────────── */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                    {/* Error banner */}
                    {error && (
                        <div style={{
                            padding: '10px 14px', borderRadius: '8px', marginBottom: '14px',
                            background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                            color: '#F87171', fontSize: '12px',
                        }}>
                            ⚠️ {error}
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
                            partName={partName}
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
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', justifyContent: 'space-between', gap: '10px',
                    flexShrink: 0,
                }}>
                    <button
                        onClick={() => step > 1 ? setStep(step - 1) : closeJobCreationModal()}
                        style={{
                            padding: '10px 20px', borderRadius: '8px', fontSize: '13px',
                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                            color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600,
                        }}
                    >
                        {step === 1 ? 'Cancel' : '← Back'}
                    </button>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        {step === 3 && specs.length > 0 && (
                            <button
                                onClick={handleConfirmAll}
                                disabled={confirming}
                                style={{
                                    padding: '10px 20px', borderRadius: '8px', fontSize: '13px',
                                    background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)',
                                    color: '#34D399', cursor: 'pointer', fontWeight: 600,
                                }}
                            >
                                {confirming ? '⟳ Confirming…' : '✓ Confirm All & Continue'}
                            </button>
                        )}
                        {step < 3 && (
                            <button
                                onClick={() => goToStep(step + 1)}
                                disabled={creatingTask}
                                style={{
                                    padding: '10px 24px', borderRadius: '8px', fontSize: '13px',
                                    background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                                    border: 'none', color: 'white', cursor: 'pointer', fontWeight: 700,
                                }}
                            >
                                {creatingTask ? '⟳ Creating…' : 'Continue →'}
                            </button>
                        )}
                        {step === 3 && specs.length === 0 && (
                            <button
                                onClick={handleExtract}
                                disabled={extracting}
                                style={{
                                    padding: '10px 24px', borderRadius: '8px', fontSize: '13px',
                                    background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                                    border: 'none', color: 'white', cursor: 'pointer', fontWeight: 700,
                                }}
                            >
                                {extracting ? '⟳ Extracting…' : '✨ Extract with AI'}
                            </button>
                        )}
                        {step === 4 && (
                            <button
                                onClick={handleLock}
                                disabled={locking || lockingJob}
                                style={{
                                    padding: '10px 24px', borderRadius: '8px', fontSize: '13px',
                                    background: 'linear-gradient(135deg, #10B981, #059669)',
                                    border: 'none', color: 'white', cursor: 'pointer', fontWeight: 700,
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                }}
                            >
                                {(locking || lockingJob) ? '⟳ Locking…' : '🔒 Verify & Lock Job'}
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
    partName,
}) {
    const confidenceColor = (c) => {
        if (!c) return '#8B8FA8';
        if (c >= 0.85) return '#34D399';
        if (c >= 0.70) return '#FBBF24';
        return '#F87171';
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{
                padding: '14px',
                borderRadius: '10px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
            }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                    DRAWING UPLOAD *
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
                        style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: 700,
                            border: '1px solid rgba(99,102,241,0.3)',
                            background: 'rgba(99,102,241,0.15)',
                            color: '#A5B4FC',
                            cursor: !drawingFile || drawingUploading ? 'not-allowed' : 'pointer',
                            opacity: !drawingFile || drawingUploading ? 0.6 : 1,
                        }}
                    >
                        {drawingUploading ? '⟳ Uploading…' : 'Upload Drawing'}
                    </button>
                </div>
                <div style={{ fontSize: '10px', color: drawingUploadedUrl ? '#34D399' : 'var(--text-muted)', marginTop: '8px' }}>
                    {drawingUploadedUrl ? 'Drawing linked to this job.' : 'Upload a drawing image, or provide detailed OCR/spec text below.'}
                </div>
            </div>

            {/* Drawing context input */}
            <div>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', fontWeight: 600, letterSpacing: '0.03em' }}>
                    DRAWING DESCRIPTION / OCR TEXT <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>(Optional but recommended)</span>
                </label>
                <textarea
                    value={drawingContext}
                    onChange={(e) => setDrawingContext(e.target.value)}
                    placeholder={`Paste drawing text, dimensions, or part description here...\n\nExample: "Overall length 450mm, OD1: 60mm, OD2: 45mm, OD3: 35mm, Thread M30x2, Keyway 12mm wide, Surface roughness Ra 1.6, Runout 0.02mm"`}
                    className="input-glass"
                    style={{ width: '100%', minHeight: '100px', resize: 'vertical', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.6, boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Leave blank to use AI heuristics for "{partName}" — you can edit all values in the table.
                </div>
            </div>

            {/* Specs table */}
            {specs.length > 0 ? (
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                            🧠 AI Extracted Specifications
                        </div>
                        <span style={{
                            fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                            background: 'rgba(99,102,241,0.15)', color: '#A5B4FC', border: '1px solid rgba(99,102,241,0.2)',
                        }}>
                            {specs.filter((s) => s.is_confirmed).length}/{specs.length} confirmed
                        </span>
                    </div>

                    {/* Table header */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: '2fr 1.5fr 80px 1.5fr',
                        gap: '8px', padding: '6px 10px', borderRadius: '6px 6px 0 0',
                        background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}>
                        {['Parameter', 'AI Value', 'Conf.', 'Your Value'].map((h) => (
                            <div key={h} style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{h}</div>
                        ))}
                    </div>

                    {/* Table rows */}
                    <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'hidden' }}>
                        {specs.map((spec, idx) => (
                            <div key={spec.id} style={{
                                display: 'grid', gridTemplateColumns: '2fr 1.5fr 80px 1.5fr',
                                gap: '8px', padding: '8px 10px', alignItems: 'center',
                                background: idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                                borderBottom: idx < specs.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                            }}>
                                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    {spec.field_name.replace(/_/g, ' ')}
                                    {spec.unit && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({spec.unit})</span>}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                    {spec.ai_value || '—'}
                                </div>
                                <div style={{ fontSize: '12px', fontWeight: 700, color: confidenceColor(spec.ai_confidence) }}>
                                    {spec.ai_confidence ? `${Math.round(spec.ai_confidence * 100)}%` : '—'}
                                </div>
                                <input
                                    type="text"
                                    defaultValue={spec.human_value || spec.ai_value || ''}
                                    onChange={(e) => onSpecEdit(spec, e.target.value)}
                                    placeholder={spec.ai_value || 'Enter value'}
                                    style={{
                                        background: spec.is_confirmed ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.05)',
                                        border: `1px solid ${spec.is_confirmed ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.1)'}`,
                                        borderRadius: '6px', color: 'var(--text-primary)',
                                        padding: '5px 8px', fontSize: '12px', fontFamily: 'monospace',
                                        width: '100%', boxSizing: 'border-box',
                                    }}
                                />
                            </div>
                        ))}
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                        ✏️ Edit any value in "Your Value" column. Click "Confirm All & Continue" when ready.
                    </div>
                </div>
            ) : (
                <div style={{
                    textAlign: 'center', padding: '32px',
                    background: 'rgba(99,102,241,0.05)',
                    border: '1px dashed rgba(99,102,241,0.2)',
                    borderRadius: '12px',
                }}>
                    <div style={{ fontSize: '32px', marginBottom: '10px' }}>🧠</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                        Ready to Extract Specs
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '300px', margin: '0 auto' }}>
                        Click "Extract with AI" below to analyze the drawing and populate the specification table.
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
