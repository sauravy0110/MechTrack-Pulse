import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import useAppStore from '../stores/appStore';
import { X, Plus, FileText, Sparkles, CalendarClock } from 'lucide-react';
import api from '../api/client';

const INITIAL_FORM = {
    task_name: '',
    description: '',
    machine_id: '',
    client_id: '',
    priority: 'medium',
    estimated_completion: '',
};

export default function CreateTaskModal() {
    const closeModal = useAppStore((state) => state.closeCreateTaskModal);
    const createTask = useAppStore((state) => state.createTask);
    const creatingTask = useAppStore((state) => state.creatingTask);
    const machines = useAppStore((state) => state.machines);
    const users = useAppStore((state) => state.users);
    const defaultMachineId = useAppStore((state) => state.createTaskMachineId);

    const [formData, setFormData] = useState(() => ({ ...INITIAL_FORM, machine_id: defaultMachineId || '' }));
    const [error, setError] = useState('');
    const [generatingInstructions, setGeneratingInstructions] = useState(false);

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape' && !creatingTask) closeModal(); };
        window.addEventListener('keydown', h);
        document.body.classList.add('modal-open');
        return () => {
            window.removeEventListener('keydown', h);
            document.body.classList.remove('modal-open');
        };
    }, [creatingTask, closeModal]);

    const handleChange = (e) => { setFormData((c) => ({ ...c, [e.target.name]: e.target.value })); setError(''); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const title = formData.task_name.trim();
        if (title.length < 2) { setError('Task name must be at least 2 characters.'); return; }
        try {
            await createTask({
                title,
                description: formData.description.trim(),
                machine_id: formData.machine_id,
                priority: formData.priority,
                client_id: formData.client_id,
                estimated_completion: formData.estimated_completion ? new Date(formData.estimated_completion).toISOString() : null,
            });
            closeModal();
        }
        catch (err) { setError(err.message || 'Unable to create task.'); }
    };

    const priorityColors = { low: 'text-text-muted', medium: 'text-accent', high: 'text-warning', critical: 'text-danger' };
    const clients = users.filter((user) => user.role === 'client');

    const handleGenerateInstructions = async () => {
        const title = formData.task_name.trim();
        if (title.length < 2) {
            setError('Enter the task name first so AI can generate useful instructions.');
            return;
        }

        setGeneratingInstructions(true);
        setError('');
        try {
            const machineName = machines.find((machine) => machine.id === formData.machine_id)?.name || null;
            const { data } = await api.post('/ai/generate-instructions', {
                title,
                description: formData.description,
                machine_name: machineName,
                priority: formData.priority,
            });
            setFormData((current) => ({
                ...current,
                description: data.instruction_text || current.description,
            }));
        } catch (err) {
            setError(err.response?.data?.detail || 'Unable to generate instructions right now.');
        } finally {
            setGeneratingInstructions(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={closeModal}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="modal-shell w-full max-w-lg rounded-[30px] p-7 shadow-2xl sm:p-8"
                onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Task management</p>
                        <h2 className="font-display mt-2 text-3xl tracking-tight text-text-primary">Create Task</h2>
                        <p className="mt-2 text-xs leading-6 text-text-secondary">Dispatch a task. Assign the operator from the machine detail panel.</p>
                    </div>
                    <button type="button" onClick={closeModal} disabled={creatingTask}
                        className="modal-close disabled:opacity-50"><X size={14} /> Close</button>
                </div>

                {error && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                        className="mt-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger">{error}</motion.div>
                )}

                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                    <div>
                        <label htmlFor="task_name" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                            <FileText size={12} className="text-text-muted" /> Task name
                        </label>
                        <input id="task_name" name="task_name" type="text" value={formData.task_name} onChange={handleChange}
                            className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="Inspect spindle vibration" autoFocus required />
                    </div>
                    <div>
                        <div className="mb-1.5 flex items-center justify-between gap-3">
                            <label htmlFor="description" className="text-xs font-semibold">Instructions</label>
                            <button
                                type="button"
                                onClick={handleGenerateInstructions}
                                disabled={generatingInstructions}
                                className="btn-ghost rounded-full px-3 py-1.5 text-[11px] font-semibold"
                            >
                                <Sparkles size={12} className="inline mr-1" />
                                {generatingInstructions ? 'Generating...' : 'AI Draft'}
                            </button>
                        </div>
                        <textarea
                            id="description"
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            rows={4}
                            className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                            placeholder="Attach instructions, quality checkpoints, or operator guidance"
                        />
                    </div>
                    <div>
                        <label htmlFor="machine_id" className="mb-1.5 block text-xs font-semibold">Machine</label>
                        <select id="machine_id" name="machine_id" value={formData.machine_id} onChange={handleChange}
                            className="input-glass w-full rounded-xl px-4 py-3 text-sm">
                            <option value="">No machine selected</option>
                            {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor="client_id" className="mb-1.5 block text-xs font-semibold">Client</label>
                            <select
                                id="client_id"
                                name="client_id"
                                value={formData.client_id}
                                onChange={handleChange}
                                className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                            >
                                <option value="">No client linked</option>
                                {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="estimated_completion" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                                <CalendarClock size={12} className="text-text-muted" />
                                Deadline
                            </label>
                            <input
                                id="estimated_completion"
                                name="estimated_completion"
                                type="datetime-local"
                                value={formData.estimated_completion}
                                onChange={handleChange}
                                className="input-glass w-full rounded-xl px-4 py-3 text-sm"
                            />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="priority" className="mb-1.5 block text-xs font-semibold">
                            Priority <span className={`ml-1 font-mono text-[10px] ${priorityColors[formData.priority]}`}>{formData.priority.toUpperCase()}</span>
                        </label>
                        <select id="priority" name="priority" value={formData.priority} onChange={handleChange}
                            className="input-glass w-full rounded-xl px-4 py-3 text-sm">
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                        </select>
                    </div>

                    <div className="glass-card rounded-xl px-4 py-3 text-xs text-text-secondary">
                        {machines.length > 0
                            ? 'Task instructions, client visibility, and machine context will sync instantly to the control room.'
                            : 'No machines yet. You can still create and plan an unassigned task.'}
                    </div>

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button type="button" onClick={closeModal} disabled={creatingTask}
                            className="btn-ghost rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-50">Cancel</button>
                        <motion.button type="submit" disabled={creatingTask} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                            className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                            {creatingTask ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> :
                                <><Plus size={14} /> Create Task</>}
                        </motion.button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
}
