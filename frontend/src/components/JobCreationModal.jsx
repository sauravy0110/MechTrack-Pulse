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
const OPERATION_OPTIONS = ['Facing', 'Rough Turning', 'Finish Turning', 'Threading', 'Other'];
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
        operators, fetchOperators,
        createCNCJob, createClient,
        extractJobSpecs, updateJobSpec, addJobSpec, deleteJobSpec, confirmAllSpecs, lockJob,
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
    const [operationType, setOperationType] = useState('');
    const [operationOther, setOperationOther] = useState('');
    const [selectedMachineId, setSelectedMachineId] = useState('');
    const [selectedOperatorId, setSelectedOperatorId] = useState('');
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
    const [manualSpecDraft, setManualSpecDraft] = useState({
        field_name: '',
        human_value: '',
        unit: 'mm',
    });
    const [savingManualSpec, setSavingManualSpec] = useState(false);
    const [deletingSpecId, setDeletingSpecId] = useState('');

    // Step 4: Lock
    const [locking, setLocking] = useState(false);

    useEffect(() => {
        if (isJobCreationModalOpen) {
            fetchClients();
            fetchMachines();
            fetchOperators();
            fetchAIProviderStatus();
            resetState();
            document.body.classList.add('modal-open');
        }
        return () => document.body.classList.remove('modal-open');
    }, [isJobCreationModalOpen, fetchAIProviderStatus, fetchClients, fetchMachines, fetchOperators]);

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
        setPartName(''); setMaterialType(''); setMaterialBatch(''); setOperationType(''); setOperationOther(''); setSelectedMachineId(''); setSelectedOperatorId(''); setPriority('medium'); setDescription('');
        setDrawingContext(''); setDrawingFile(null); setDrawingUploadedUrl(''); setDrawingUploading(false); setExtracting(false); setSpecs([]); setEditedSpecs({}); setExtractionMessage(''); setValidationSummary(null); setConfirming(false); setLocking(false);
        setManualSpecDraft({ field_name: '', human_value: '', unit: 'mm' }); setSavingManualSpec(false); setDeletingSpecId('');
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
            if (!operationType) { setError('Please select the machining operation.'); return; }
            if (operationType === 'Other' && !operationOther.trim()) { setError('Please specify the custom operation.'); return; }

            // Create the CNC job if not created yet
            if (!taskId) {
                try {
                    const job = await createCNCJob({
                        title: partName,
                        description: description || null,
                        priority,
                        client_id: selectedClientId || null,
                        machine_id: selectedMachineId || null,
                        assigned_to: selectedOperatorId || null,
                        part_name: partName,
                        material_type: materialType || null,
                        material_batch: materialBatch || null,
                        operation_type: operationType || null,
                        operation_other: operationType === 'Other' ? operationOther : null,
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
        if (drawingUploadedUrl && !drawingContext.trim() && aiProviderStatus?.enabled !== true) {
            setError(
                'Image OCR needs OPENROUTER_API_KEY. Paste drawing text or configure OpenRouter to use the free vision-capable router.'
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

    const handleManualProceed = async () => {
        if (specs.length === 0) {
            setError('Add at least one manual specification before continuing without AI extraction.');
            return;
        }
        setError('');
        setStep(4);
    };

    const handleAddManualSpec = async () => {
        const fieldName = manualSpecDraft.field_name.trim();
        const humanValue = manualSpecDraft.human_value.trim();
        if (!fieldName || !humanValue) {
            setError('Manual mode needs both a field name and a verified value.');
            return;
        }

        setSavingManualSpec(true);
        setError('');
        try {
            const createdSpec = await addJobSpec(taskId, {
                field_name: fieldName,
                human_value: humanValue,
                unit: manualSpecDraft.unit.trim() || 'mm',
                ai_value: null,
                ai_confidence: 0,
            });
            setSpecs((current) => [...current, createdSpec]);
            setManualSpecDraft({ field_name: '', human_value: '', unit: manualSpecDraft.unit || 'mm' });
        } catch (e) {
            setError(e.message);
        } finally {
            setSavingManualSpec(false);
        }
    };

    const handleDeleteSpec = async (specId) => {
        setDeletingSpecId(specId);
        setError('');
        try {
            await deleteJobSpec(specId);
            setSpecs((current) => current.filter((spec) => spec.id !== specId));
            setEditedSpecs((current) => {
                const next = { ...current };
                delete next[specId];
                return next;
            });
        } catch (e) {
            setError(e.message);
        } finally {
            setDeletingSpecId('');
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
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeJobCreationModal(); }}>
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
                            operationType={operationType} setOperationType={setOperationType}
                            operationOther={operationOther} setOperationOther={setOperationOther}
                            selectedMachineId={selectedMachineId} setSelectedMachineId={setSelectedMachineId}
                            selectedOperatorId={selectedOperatorId} setSelectedOperatorId={setSelectedOperatorId}
                            priority={priority} setPriority={setPriority}
                            description={description} setDescription={setDescription}
                            machines={machines}
                            operators={operators}
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
                            specs={specs}
                            onSpecEdit={handleSpecEdit}
                            editedSpecs={editedSpecs}
                            extractionMessage={extractionMessage}
                            validationSummary={validationSummary}
                            partName={partName}
                            aiProviderStatus={aiProviderStatus}
                            manualSpecDraft={manualSpecDraft}
                            setManualSpecDraft={setManualSpecDraft}
                            onAddManualSpec={handleAddManualSpec}
                            savingManualSpec={savingManualSpec}
                            onDeleteSpec={handleDeleteSpec}
                            deletingSpecId={deletingSpecId}
                        />
                    )}

                    {/* ─── STEP 4: Verify & Lock ─── */}
                    {step === 4 && (
                        <StepVerifyLock
                            specs={specs}
                            partName={partName} materialType={materialType}
                            operationType={operationType}
                            operationOther={operationOther}
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
                            <>
                                <button
                                    type="button"
                                    onClick={handleManualProceed}
                                    className="rounded-xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm font-semibold text-accent"
                                >
                                    Continue Manually
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConfirmAll}
                                    disabled={confirming || hasBlockingInvalidSpecs}
                                    className="rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-sm font-semibold text-success disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {confirming ? 'Confirming...' : hasBlockingInvalidSpecs ? 'Resolve Invalid Fields' : 'Review Complete & Continue'}
                                </button>
                            </>
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
                            <>
                                <button
                                    type="button"
                                    onClick={handleManualProceed}
                                    className="rounded-xl border border-accent/25 bg-accent/10 px-5 py-3 text-sm font-semibold text-accent"
                                >
                                    Proceed Manually
                                </button>
                                <button
                                    type="button"
                                    onClick={handleExtract}
                                    disabled={extracting}
                                    className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {extracting ? 'Extracting...' : 'Extract Specs'}
                                </button>
                            </>
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
        <div className="space-y-5">
            <SectionCard
                eyebrow="Client Link"
                title="Choose how this job should be attached"
                description="Link an existing client for visibility, or create a polished client record before the CNC job moves forward."
            >
                <div className="grid gap-3 md:grid-cols-2">
                    {[{ id: 'existing', label: 'Existing Client', hint: 'Pick from the active client list' }, { id: 'new', label: 'New Client', hint: 'Create a portal-ready client profile' }].map((mode) => {
                        const active = clientMode === mode.id;
                        return (
                            <button
                                key={mode.id}
                                type="button"
                                onClick={() => setClientMode(mode.id)}
                                className={`rounded-2xl border px-4 py-4 text-left transition ${active ? 'border-accent/35 bg-accent/10 shadow-[0_12px_30px_rgba(99,102,241,0.12)]' : 'border-border/70 bg-bg-hover/30 hover:border-accent/20 hover:bg-bg-hover/50'}`}
                            >
                                <div className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">{mode.label}</div>
                                <p className="mt-2 text-sm text-text-primary">{mode.hint}</p>
                            </button>
                        );
                    })}
                </div>
            </SectionCard>

            {clientMode === 'existing' && (
                <SectionCard eyebrow="Directory" title="Select the client" description="The selected client will receive progress visibility as the job moves through MES stages.">
                    {clients.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border/70 bg-bg-hover/25 px-5 py-8 text-center text-sm text-text-secondary">
                            No clients found yet. Switch to <strong>New Client</strong> to create one here.
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {clients.map((client) => {
                                const active = selectedClientId === client.id;
                                return (
                                    <button
                                        key={client.id}
                                        type="button"
                                        onClick={() => setSelectedClientId(client.id)}
                                        className={`flex items-center gap-4 rounded-2xl border px-4 py-4 text-left transition ${active ? 'border-success/30 bg-success/10' : 'border-border/70 bg-bg-hover/30 hover:border-accent/20 hover:bg-bg-hover/50'}`}
                                    >
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(56,189,248,0.9),rgba(99,102,241,0.85))] text-sm font-bold text-white">
                                            {client.company_name?.[0]?.toUpperCase() || client.contact_person?.[0]?.toUpperCase() || '?'}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-semibold text-text-primary">{client.company_name}</div>
                                            <div className="mt-1 truncate text-xs text-text-secondary">{client.contact_person || 'No contact'} • {client.email || 'No email'}</div>
                                        </div>
                                        <div className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${active ? 'border-success/30 bg-success/12 text-success' : 'border-border/70 bg-bg-hover/40 text-text-muted'}`}>
                                            {active ? 'Selected' : 'Choose'}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </SectionCard>
            )}

            {clientMode === 'new' && (
                <SectionCard eyebrow="Client Intake" title="Create a clean client profile" description="This layout is tuned for quick data entry so email, phone, and company information stay readable and easy to review.">
                    <div className="space-y-4">
                        {createdClientCreds && (
                            <div className="rounded-2xl border border-success/25 bg-success/8 p-4">
                                <div className="text-xs font-bold uppercase tracking-[0.18em] text-success">Credentials Ready</div>
                                <div className="mt-3 space-y-1 font-mono text-xs text-text-primary">
                                    <div>Client ID: {createdClientCreds.client_id}</div>
                                    <div>Username: {createdClientCreds.username}</div>
                                    <div>Temp Password: {createdClientCreds.temp_password}</div>
                                </div>
                                <p className="mt-2 text-[11px] text-text-secondary">The client will be asked to change the password after first login.</p>
                                <button
                                    type="button"
                                    onClick={() => navigator.clipboard.writeText(`Client ID: ${createdClientCreds.client_id}\nUsername: ${createdClientCreds.username}\nTemp Password: ${createdClientCreds.temp_password}`)}
                                    className="mt-3 rounded-xl border border-success/30 bg-success/12 px-3 py-2 text-xs font-semibold text-success"
                                >
                                    Copy Credentials
                                </button>
                            </div>
                        )}

                        <div className="grid gap-4 md:grid-cols-2">
                            <FormField label="Company Name *" value={newClient.company_name} onChange={(v) => setNewClient((p) => ({ ...p, company_name: v }))} placeholder="Acme Motion Pvt Ltd" />
                            <FormField label="Contact Person *" value={newClient.contact_person} onChange={(v) => setNewClient((p) => ({ ...p, contact_person: v }))} placeholder="Riya Shah" />
                            <FormField label="Client Email *" type="email" value={newClient.email} onChange={(v) => setNewClient((p) => ({ ...p, email: v }))} placeholder="riya@acmemotion.com" />
                            <FormField label="Phone" value={newClient.phone} onChange={(v) => setNewClient((p) => ({ ...p, phone: v }))} placeholder="+91 98765 43210" />
                        </div>

                        <FormField label="Address" value={newClient.address} onChange={(v) => setNewClient((p) => ({ ...p, address: v }))} placeholder="Factory address, billing address, or dispatch location" multiline />

                        <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-bg-hover/30 px-4 py-3 text-sm text-text-secondary">
                            <input
                                type="checkbox"
                                checked={newClient.send_email}
                                onChange={(e) => setNewClient((p) => ({ ...p, send_email: e.target.checked }))}
                                className="h-4 w-4 accent-[var(--accent)]"
                            />
                            Send login credentials automatically after the client is created
                        </label>
                    </div>
                </SectionCard>
            )}
        </div>
    );
}

function StepPartDetails({
    partName,
    setPartName,
    materialType,
    setMaterialType,
    materialBatch,
    setMaterialBatch,
    operationType,
    setOperationType,
    operationOther,
    setOperationOther,
    selectedMachineId,
    setSelectedMachineId,
    selectedOperatorId,
    setSelectedOperatorId,
    priority,
    setPriority,
    description,
    setDescription,
    machines,
    operators,
}) {
    const recommendedOperator = (operators || [])
        .filter((operator) => operator.is_on_duty && (operator.current_task_count || 0) < 5)
        .sort((a, b) => {
            const skillDiff = (b.skill_score ?? 0) - (a.skill_score ?? 0);
            if (skillDiff !== 0) return skillDiff;
            const queueDiff = (a.current_task_count || 0) - (b.current_task_count || 0);
            if (queueDiff !== 0) return queueDiff;
            return a.full_name.localeCompare(b.full_name);
        })[0] || null;

    const operatorOptions = (operators || [])
        .sort((a, b) => {
            const aAvailable = a.is_on_duty && (a.current_task_count || 0) < 5 ? 0 : 1;
            const bAvailable = b.is_on_duty && (b.current_task_count || 0) < 5 ? 0 : 1;
            if (aAvailable !== bAvailable) return aAvailable - bAvailable;
            const prioritySkillDiff = (b.skill_score ?? 0) - (a.skill_score ?? 0);
            if (prioritySkillDiff !== 0) return prioritySkillDiff;
            const queueDiff = (a.current_task_count || 0) - (b.current_task_count || 0);
            if (queueDiff !== 0) return queueDiff;
            return a.full_name.localeCompare(b.full_name);
        })
        .map((operator) => ({
            label: `${operator.full_name} (${operator.current_task_count || 0}/5)${operator.is_on_duty ? ((operator.current_task_count || 0) >= 5 ? ' • Full' : ' • Available') : ' • Offline'}${operator.skill_score != null ? ` • Skill ${Math.round(operator.skill_score)}` : ''}`,
            value: operator.id,
        }));

    return (
        <div className="space-y-5">
            <SectionCard
                eyebrow="Job Identity"
                title="Define the CNC work clearly"
                description="This step now groups the job title, material, operation, machine, and priority into a cleaner planning layout."
            >
                <div className="space-y-4">
                    <FormField label="Part Name / Job Title *" value={partName} onChange={setPartName} placeholder="Drive shaft step turning for batch A" />
                    <FormField label="Description" value={description} onChange={setDescription} placeholder="Add customer notes, tolerance reminders, setup instructions, or inspection context" multiline />
                </div>
            </SectionCard>

            <SectionCard eyebrow="Material + Operation" title="Capture the machining inputs" description="Material and operation selection now sit together so operators understand what process this job is entering.">
                <div className="grid gap-4 md:grid-cols-2">
                    <SelectField label="Material Type" value={materialType} onChange={setMaterialType} options={MATERIAL_OPTIONS} placeholder="Select material" />
                    <FormField label="Material Batch No." value={materialBatch} onChange={setMaterialBatch} placeholder="BT-2024-007" />
                    <SelectField
                        label="Operation *"
                        value={operationType}
                        onChange={(value) => {
                            setOperationType(value);
                            if (value !== 'Other') {
                                setOperationOther('');
                            }
                        }}
                        options={OPERATION_OPTIONS}
                        placeholder="Select operation"
                    />
                    {operationType === 'Other' ? (
                        <FormField label="Other Operation *" value={operationOther} onChange={setOperationOther} placeholder="Enter the custom machining operation" />
                    ) : (
                        <div className="rounded-2xl border border-dashed border-border/70 bg-bg-hover/25 px-4 py-4 text-sm text-text-secondary">
                            Choose <strong>Other</strong> to type a custom operation name.
                        </div>
                    )}
                </div>
            </SectionCard>

            <SectionCard eyebrow="Planning" title="Assignment and scheduling" description="Choose the preferred machine, optionally pre-assign an operator, and set the urgency in one structured block.">
                <div className="mb-4 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">AI Recommended</div>
                            <p className="mt-2 text-sm font-semibold text-text-primary">
                                {recommendedOperator ? recommendedOperator.full_name : 'No operator currently available for auto assignment'}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-text-secondary">
                                {recommendedOperator
                                    ? `Skill ${Math.round(recommendedOperator.skill_score ?? 0)} • ${(recommendedOperator.current_task_count || 0)}/5 tasks • AI recommended`
                                    : 'Manual selection is still available from the company operator list below.'}
                            </p>
                        </div>
                        {recommendedOperator ? (
                            <button
                                type="button"
                                onClick={() => setSelectedOperatorId(recommendedOperator.id)}
                                className="rounded-xl border border-accent/25 bg-white/70 px-4 py-3 text-sm font-semibold text-accent"
                            >
                                Auto Assign Recommended
                            </button>
                        ) : null}
                    </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                    <SelectField label="Machine" value={selectedMachineId} onChange={setSelectedMachineId} options={machines.map((machine) => ({ label: machine.name, value: machine.id }))} placeholder="Assign later" />
                    <SelectField label="Assign Operator" value={selectedOperatorId} onChange={setSelectedOperatorId} options={operatorOptions} placeholder="Select operator manually or assign later" />
                    <SelectField label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS.map((item) => ({ label: item.charAt(0).toUpperCase() + item.slice(1), value: item }))} placeholder="Select priority" />
                </div>
                <p className="text-xs leading-6 text-text-secondary">
                    The AI recommendation is shown above. Below that, all company operators are listed for manual assignment by name. If you leave it blank, the job stays unassigned for later scheduling.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-border/70 bg-bg-hover/25 px-4 py-4 text-sm text-text-secondary">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Machine</div>
                        <p className="mt-2 text-text-primary">{selectedMachineId ? machines.find((machine) => machine.id === selectedMachineId)?.name || 'Selected' : 'Not fixed yet'}</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-bg-hover/25 px-4 py-4 text-sm text-text-secondary">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Operator</div>
                        <p className="mt-2 text-text-primary">{selectedOperatorId ? operators.find((operator) => operator.id === selectedOperatorId)?.full_name || 'Selected' : 'Auto / later assignment'}</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-bg-hover/25 px-4 py-4 text-sm text-text-secondary">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Priority</div>
                        <p className="mt-2 capitalize text-text-primary">{priority}</p>
                    </div>
                </div>
            </SectionCard>
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
    onSpecEdit,
    editedSpecs,
    extractionMessage,
    validationSummary,
    partName,
    aiProviderStatus,
    manualSpecDraft,
    setManualSpecDraft,
    onAddManualSpec,
    savingManualSpec,
    onDeleteSpec,
    deletingSpecId,
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
                                ? 'Uploaded drawings will use the configured OpenRouter vision model with the free fallback route and text parsing as backup.'
                                : aiReady
                                    ? 'OpenRouter is connected and image OCR will fall back to the free OpenRouter router when no dedicated vision model is set. Pasted drawing text still gives the cleanest results.'
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

            <div className="glass-card rounded-2xl border border-border/70 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
                            Manual Specs
                        </div>
                        <p className="mt-2 text-xs leading-6 text-text-secondary">
                            If AI extraction fails, add the important dimensions manually here and use the manual continue button.
                        </p>
                    </div>
                    <span className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                        OCR Optional
                    </span>
                </div>

                <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_110px_auto]">
                    <input
                        type="text"
                        value={manualSpecDraft.field_name}
                        onChange={(e) => setManualSpecDraft((current) => ({ ...current, field_name: e.target.value }))}
                        placeholder="Field name e.g. OD, Length, Thread"
                        className="input-glass w-full rounded-xl px-3 py-2 text-xs"
                    />
                    <input
                        type="text"
                        value={manualSpecDraft.human_value}
                        onChange={(e) => setManualSpecDraft((current) => ({ ...current, human_value: e.target.value }))}
                        placeholder="Verified value"
                        className="input-glass w-full rounded-xl px-3 py-2 text-xs font-mono"
                    />
                    <input
                        type="text"
                        value={manualSpecDraft.unit}
                        onChange={(e) => setManualSpecDraft((current) => ({ ...current, unit: e.target.value }))}
                        placeholder="mm"
                        className="input-glass w-full rounded-xl px-3 py-2 text-xs"
                    />
                    <button
                        type="button"
                        onClick={onAddManualSpec}
                        disabled={savingManualSpec}
                        className="rounded-xl border border-success/25 bg-success/10 px-4 py-2 text-xs font-semibold text-success disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {savingManualSpec ? 'Adding...' : 'Add Spec'}
                    </button>
                </div>
                <div className="mt-3 text-[11px] text-text-muted">
                    Example manual rows: Overall Length = 450 mm, OD1 = 60 mm, Thread = M30x2.
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
                                            <div className="flex items-start gap-2">
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
                                                <button
                                                    type="button"
                                                    onClick={() => onDeleteSpec(spec.id)}
                                                    disabled={deletingSpecId === spec.id}
                                                    className="rounded-xl border border-danger/20 bg-danger/8 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-danger disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {deletingSpecId === spec.id ? '...' : 'Delete'}
                                                </button>
                                            </div>
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
                        Ready for AI Extraction or Manual Entry
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '300px', margin: '0 auto' }}>
                        Upload the drawing, paste any readable text you have, or add verified spec rows manually before continuing.
                    </div>
                    {extractionMessage ? (
                        <div className="mx-auto mt-4 max-w-[420px] rounded-2xl border border-warning/20 bg-warning/8 px-4 py-3 text-left text-xs leading-6 text-text-secondary">
                            {extractionMessage}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

function StepVerifyLock({ specs, partName, materialType, operationType, operationOther, priority }) {
    const confirmedCount = specs.filter((s) => s.is_confirmed).length;
    const allConfirmed = confirmedCount === specs.length && specs.length > 0;
    const operationLabel = operationType === 'Other' ? operationOther || 'Other' : operationType || 'Not specified';

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
                <SummaryRow icon="🛠️" label="Operation" value={operationLabel} />
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

function SectionCard({ eyebrow, title, description, children }) {
    return (
        <section className="glass-card rounded-[26px] border border-border/70 p-5">
            <div className="mb-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
                <h3 className="mt-2 text-xl font-display text-text-primary">{title}</h3>
                {description ? <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p> : null}
            </div>
            {children}
        </section>
    );
}

function FormField({ label, value, onChange, placeholder, type = 'text', multiline = false }) {
    const baseClass = 'input-glass w-full rounded-2xl border border-border/70 bg-bg-hover/35 px-4 py-3 text-sm text-text-primary placeholder:text-text-muted/80';

    return (
        <div>
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-text-secondary">
                {label}
            </label>
            {multiline ? (
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={`${baseClass} min-h-[110px] resize-y leading-6`}
                />
            ) : (
                <input
                    type={type}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={baseClass}
                />
            )}
        </div>
    );
}

function SelectField({ label, value, onChange, options, placeholder }) {
    const normalizedOptions = options.map((option) => (
        typeof option === 'string'
            ? { label: option, value: option }
            : option
    ));

    return (
        <div>
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-text-secondary">
                {label}
            </label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="input-glass w-full cursor-pointer rounded-2xl border border-border/70 bg-bg-hover/35 px-4 py-3 text-sm text-text-primary"
            >
                <option value="">{placeholder}</option>
                {normalizedOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
        </div>
    );
}
