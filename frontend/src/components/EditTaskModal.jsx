import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    CalendarClock,
    Factory,
    FilePenLine,
    Layers3,
    Package,
    X,
} from 'lucide-react';
import useAppStore from '../stores/appStore';

const MATERIAL_OPTIONS = ['EN8', 'EN9', 'EN24', 'SS304', 'SS316', 'MS', 'Mild Steel', 'Cast Iron', 'Alloy Steel', 'Aluminium 6061', 'Other'];
const OPERATION_OPTIONS = ['Facing', 'Rough Turning', 'Finish Turning', 'Threading', 'Other'];
const CNC_STATUSES = new Set(['created', 'planned', 'ready', 'assigned', 'setup', 'setup_done', 'first_piece_approval', 'qc_check', 'final_inspection', 'dispatched']);

function isCNCJob(task) {
    return Boolean(task?.is_locked || task?.part_name || CNC_STATUSES.has(task?.status));
}

function toDatetimeLocal(value) {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const pad = (part) => String(part).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createInitialForm(task) {
    return {
        title: task?.title || '',
        description: task?.description || '',
        machine_id: task?.machine_id || '',
        client_id: task?.client_id || '',
        priority: task?.priority || 'medium',
        estimated_completion: toDatetimeLocal(task?.estimated_completion),
        part_name: task?.part_name || '',
        material_type: task?.material_type || '',
        material_batch: task?.material_batch || '',
        operation_type: task?.operation_type || '',
        operation_other: task?.operation_other || '',
    };
}

function FieldShell({ label, hint = '', children }) {
    return (
        <label className="block">
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">{label}</span>
                {hint ? <span className="text-[10px] text-text-muted">{hint}</span> : null}
            </div>
            {children}
        </label>
    );
}

export default function EditTaskModal() {
    const isOpen = useAppStore((state) => state.isEditTaskModalOpen);
    const editingTask = useAppStore((state) => state.editingTask);
    const closeModal = useAppStore((state) => state.closeEditTaskModal);
    const updateTaskDetails = useAppStore((state) => state.updateTaskDetails);
    const updatingTaskDetails = useAppStore((state) => state.updatingTaskDetails);
    const machines = useAppStore((state) => state.machines);
    const users = useAppStore((state) => state.users);

    const [formData, setFormData] = useState(() => createInitialForm(editingTask));
    const [error, setError] = useState('');

    const clients = useMemo(() => users.filter((user) => user.role === 'client'), [users]);
    const showCNCFields = useMemo(() => isCNCJob(editingTask), [editingTask]);
    const cncFieldsLocked = showCNCFields && editingTask?.is_locked;

    useEffect(() => {
        if (!isOpen || !editingTask) {
            return undefined;
        }

        setFormData(createInitialForm(editingTask));
        setError('');
    }, [isOpen, editingTask?.id]);

    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        const handleEscape = (event) => {
            if (event.key === 'Escape' && !updatingTaskDetails) {
                closeModal();
            }
        };

        document.body.classList.add('modal-open');
        window.addEventListener('keydown', handleEscape);
        return () => {
            document.body.classList.remove('modal-open');
            window.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, updatingTaskDetails, closeModal]);

    if (!isOpen || !editingTask) {
        return null;
    }

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((current) => ({
            ...current,
            [name]: value,
            ...(name === 'operation_type' && value !== 'Other' ? { operation_other: '' } : {}),
        }));
        setError('');
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const title = formData.title.trim();
        if (title.length < 2) {
            setError('Task title must be at least 2 characters.');
            return;
        }

        if (showCNCFields && formData.operation_type === 'Other' && !formData.operation_other.trim()) {
            setError('Please describe the custom machining operation.');
            return;
        }

        const payload = {
            title,
            description: formData.description.trim() || null,
            machine_id: formData.machine_id || null,
            client_id: formData.client_id || null,
            priority: formData.priority,
            estimated_completion: formData.estimated_completion
                ? new Date(formData.estimated_completion).toISOString()
                : null,
        };

        if (showCNCFields && !cncFieldsLocked) {
            Object.assign(payload, {
                part_name: formData.part_name.trim() || null,
                material_type: formData.material_type || null,
                material_batch: formData.material_batch.trim() || null,
                operation_type: formData.operation_type || null,
                operation_other: formData.operation_type === 'Other'
                    ? formData.operation_other.trim() || null
                    : null,
            });
        }

        try {
            await updateTaskDetails(editingTask.id, payload);
            closeModal();
        } catch (submitError) {
            setError(submitError.message || 'Unable to update task.');
        }
    };

    const priorityTone = {
        low: 'text-text-muted',
        medium: 'text-accent',
        high: 'text-warning',
        critical: 'text-danger',
    };

    return (
        <div className="modal-overlay" onClick={() => !updatingTaskDetails && closeModal()}>
            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.97 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="modal-shell flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[34px] shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="border-b border-border/70 px-6 py-5 sm:px-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                                    Task editor
                                </span>
                                <span className="rounded-full border border-border/70 bg-bg-hover/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                                    {editingTask.status.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <h2 className="font-display mt-3 truncate text-3xl tracking-tight text-text-primary">
                                Edit {showCNCFields ? 'Job' : 'Task'}
                            </h2>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
                                Update the live job record here. Changes sync across dashboards, profile summaries, and task views after save.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={closeModal}
                            disabled={updatingTaskDetails}
                            className="modal-close shrink-0 disabled:opacity-50"
                        >
                            <X size={14} /> Close
                        </button>
                    </div>
                </div>

                {error ? (
                    <div className="border-b border-danger/20 bg-danger/8 px-6 py-3 text-sm text-danger sm:px-8">
                        {error}
                    </div>
                ) : null}

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                    <div className="grid gap-0 xl:grid-cols-[minmax(0,1.2fr)_24rem]">
                        <div className="space-y-6 px-6 py-6 sm:px-8">
                            <section className="glass-card rounded-[28px] p-5 sm:p-6">
                                <div className="mb-5 flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                                        <FilePenLine size={18} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Core details</p>
                                        <h3 className="mt-1 text-lg font-semibold text-text-primary">Dispatch information</h3>
                                    </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="md:col-span-2">
                                        <FieldShell label="Task title">
                                            <input
                                                name="title"
                                                type="text"
                                                value={formData.title}
                                                onChange={handleChange}
                                                className="input-glass w-full rounded-2xl px-4 py-3 text-sm"
                                                placeholder="Update the job title"
                                                autoFocus
                                                required
                                            />
                                        </FieldShell>
                                    </div>

                                    <div className="md:col-span-2">
                                        <FieldShell label="Instructions" hint="Shown in task detail views">
                                            <textarea
                                                name="description"
                                                rows={5}
                                                value={formData.description}
                                                onChange={handleChange}
                                                className="input-glass min-h-[9rem] w-full rounded-2xl px-4 py-3 text-sm"
                                                placeholder="Operator guidance, checkpoints, or customer notes"
                                            />
                                        </FieldShell>
                                    </div>

                                    <FieldShell label="Machine">
                                        <select
                                            name="machine_id"
                                            value={formData.machine_id}
                                            onChange={handleChange}
                                            className="input-glass w-full rounded-2xl px-4 py-3 text-sm"
                                        >
                                            <option value="">No machine linked</option>
                                            {machines.map((machine) => (
                                                <option key={machine.id} value={machine.id}>{machine.name}</option>
                                            ))}
                                        </select>
                                    </FieldShell>

                                    <FieldShell label="Client">
                                        <select
                                            name="client_id"
                                            value={formData.client_id}
                                            onChange={handleChange}
                                            className="input-glass w-full rounded-2xl px-4 py-3 text-sm"
                                        >
                                            <option value="">No client linked</option>
                                            {clients.map((client) => (
                                                <option key={client.id} value={client.id}>{client.full_name}</option>
                                            ))}
                                        </select>
                                    </FieldShell>

                                    <FieldShell label="Priority" hint={formData.priority.toUpperCase()}>
                                        <select
                                            name="priority"
                                            value={formData.priority}
                                            onChange={handleChange}
                                            className={`input-glass w-full rounded-2xl px-4 py-3 text-sm ${priorityTone[formData.priority]}`}
                                        >
                                            <option value="low">Low</option>
                                            <option value="medium">Medium</option>
                                            <option value="high">High</option>
                                            <option value="critical">Critical</option>
                                        </select>
                                    </FieldShell>

                                    <FieldShell label="Deadline">
                                        <input
                                            name="estimated_completion"
                                            type="datetime-local"
                                            value={formData.estimated_completion}
                                            onChange={handleChange}
                                            className="input-glass w-full rounded-2xl px-4 py-3 text-sm"
                                        />
                                    </FieldShell>
                                </div>
                            </section>

                            {showCNCFields ? (
                                <section className="glass-card rounded-[28px] p-5 sm:p-6">
                                    <div className="mb-5 flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-warning/20 bg-warning/10 text-warning">
                                                <Package size={18} />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">CNC setup</p>
                                                <h3 className="mt-1 text-lg font-semibold text-text-primary">Part and operation data</h3>
                                            </div>
                                        </div>

                                        {cncFieldsLocked ? (
                                            <span className="rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-warning">
                                                Locked job
                                            </span>
                                        ) : null}
                                    </div>

                                    {cncFieldsLocked ? (
                                        <div className="mb-5 rounded-2xl border border-warning/20 bg-warning/8 px-4 py-3 text-sm text-text-secondary">
                                            This job is locked, so part, material, and operation fields are view-only. General task details can still be updated.
                                        </div>
                                    ) : null}

                                    <div className="grid gap-4 md:grid-cols-2">
                                        <FieldShell label="Part name">
                                            <input
                                                name="part_name"
                                                type="text"
                                                value={formData.part_name}
                                                onChange={handleChange}
                                                disabled={cncFieldsLocked}
                                                className="input-glass w-full rounded-2xl px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                                placeholder="Lead screw shaft"
                                            />
                                        </FieldShell>

                                        <FieldShell label="Material batch">
                                            <input
                                                name="material_batch"
                                                type="text"
                                                value={formData.material_batch}
                                                onChange={handleChange}
                                                disabled={cncFieldsLocked}
                                                className="input-glass w-full rounded-2xl px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                                placeholder="Batch / heat number"
                                            />
                                        </FieldShell>

                                        <FieldShell label="Material">
                                            <select
                                                name="material_type"
                                                value={formData.material_type}
                                                onChange={handleChange}
                                                disabled={cncFieldsLocked}
                                                className="input-glass w-full rounded-2xl px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <option value="">Select material</option>
                                                {MATERIAL_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>{option}</option>
                                                ))}
                                            </select>
                                        </FieldShell>

                                        <FieldShell label="Operation">
                                            <select
                                                name="operation_type"
                                                value={formData.operation_type}
                                                onChange={handleChange}
                                                disabled={cncFieldsLocked}
                                                className="input-glass w-full rounded-2xl px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <option value="">Select operation</option>
                                                {OPERATION_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>{option}</option>
                                                ))}
                                            </select>
                                        </FieldShell>

                                        {formData.operation_type === 'Other' ? (
                                            <div className="md:col-span-2">
                                                <FieldShell label="Custom operation">
                                                    <input
                                                        name="operation_other"
                                                        type="text"
                                                        value={formData.operation_other}
                                                        onChange={handleChange}
                                                        disabled={cncFieldsLocked}
                                                        className="input-glass w-full rounded-2xl px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                                        placeholder="Describe the machining step"
                                                    />
                                                </FieldShell>
                                            </div>
                                        ) : null}
                                    </div>
                                </section>
                            ) : null}
                        </div>

                        <aside className="border-t border-border/70 bg-bg-hover/20 px-6 py-6 xl:border-l xl:border-t-0 sm:px-8">
                            <div className="space-y-4">
                                <div className="rounded-[28px] border border-border/70 bg-bg-hover/60 p-5">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Live sync impact</p>
                                    <div className="mt-4 space-y-3">
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                                                <Factory size={15} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-text-primary">Dashboards refresh</p>
                                                <p className="mt-1 text-xs leading-5 text-text-secondary">Task boards, machine views, and owner analytics reload after save.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border border-warning/20 bg-warning/10 text-warning">
                                                <Layers3 size={15} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-text-primary">Profile counts stay accurate</p>
                                                <p className="mt-1 text-xs leading-5 text-text-secondary">Delete and edit actions now update the same shared task surfaces everywhere.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border border-border/70 bg-bg-primary text-text-muted">
                                                <CalendarClock size={15} />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-text-primary">Assignment stays separate</p>
                                                <p className="mt-1 text-xs leading-5 text-text-secondary">Use the assignment controls in the task detail panel if you need to move the job to another operator.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-[28px] border border-border/70 bg-bg-hover/60 p-5">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Current task</p>
                                    <div className="mt-3 space-y-2 text-sm text-text-secondary">
                                        <div className="flex items-center justify-between gap-3">
                                            <span>Status</span>
                                            <span className="capitalize text-text-primary">{editingTask.status.replace(/_/g, ' ')}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span>Priority</span>
                                            <span className={`font-semibold uppercase ${priorityTone[editingTask.priority]}`}>{editingTask.priority}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span>Task type</span>
                                            <span className="text-text-primary">{showCNCFields ? 'CNC job' : 'General task'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </aside>
                    </div>

                    <div className="border-t border-border/70 px-6 py-4 sm:px-8">
                        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={closeModal}
                                disabled={updatingTaskDetails}
                                className="btn-ghost rounded-2xl px-5 py-3 text-sm font-medium disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <motion.button
                                type="submit"
                                whileHover={{ scale: updatingTaskDetails ? 1 : 1.01 }}
                                whileTap={{ scale: updatingTaskDetails ? 1 : 0.98 }}
                                disabled={updatingTaskDetails}
                                className="btn-primary rounded-2xl px-6 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {updatingTaskDetails ? 'Saving changes...' : `Save ${showCNCFields ? 'Job' : 'Task'}`}
                            </motion.button>
                        </div>
                    </div>
                </form>
            </motion.div>
        </div>
    );
}
