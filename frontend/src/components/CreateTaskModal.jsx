import { useEffect, useState } from 'react';
import useAppStore from '../stores/appStore';

const INITIAL_FORM = {
    task_name: '',
    machine_id: '',
    priority: 'medium',
};

export default function CreateTaskModal() {
    const closeModal = useAppStore((state) => state.closeCreateTaskModal);
    const createTask = useAppStore((state) => state.createTask);
    const creatingTask = useAppStore((state) => state.creatingTask);
    const machines = useAppStore((state) => state.machines);
    const defaultMachineId = useAppStore((state) => state.createTaskMachineId);

    const [formData, setFormData] = useState(() => ({
        ...INITIAL_FORM,
        machine_id: defaultMachineId || '',
    }));
    const [error, setError] = useState('');

    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape' && !creatingTask) {
                closeModal();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [creatingTask, closeModal]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((current) => ({ ...current, [name]: value }));
        setError('');
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const title = formData.task_name.trim();
        if (title.length < 2) {
            setError('Task name must be at least 2 characters.');
            return;
        }

        try {
            await createTask({
                title,
                machine_id: formData.machine_id,
                priority: formData.priority,
            });
            closeModal();
        } catch (createError) {
            setError(createError.message || 'Unable to create task right now.');
        }
    };

    return (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.18)] px-4 py-8">
            <div className="w-full max-w-lg rounded-[32px] border border-border bg-white p-7 shadow-[0_24px_70px_rgba(15,23,42,0.12)] sm:p-8">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">Task management</p>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">Create Task</h2>
                        <p className="mt-3 text-sm leading-6 text-text-secondary">
                            Dispatch a new task to the factory. You can assign the operator later from the machine detail panel.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={closeModal}
                        disabled={creatingTask}
                        className="rounded-full border border-border px-3 py-2 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Close
                    </button>
                </div>

                {error ? (
                    <div className="mt-6 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                        {error}
                    </div>
                ) : null}

                <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                    <div>
                        <label htmlFor="task_name" className="mb-2 block text-sm font-medium text-text-primary">
                            Task name
                        </label>
                        <input
                            id="task_name"
                            name="task_name"
                            type="text"
                            value={formData.task_name}
                            onChange={handleChange}
                            className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                            placeholder="Inspect spindle vibration"
                            autoFocus
                            required
                        />
                    </div>

                    <div>
                        <label htmlFor="machine_id" className="mb-2 block text-sm font-medium text-text-primary">
                            Machine
                        </label>
                        <select
                            id="machine_id"
                            name="machine_id"
                            value={formData.machine_id}
                            onChange={handleChange}
                            className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                        >
                            <option value="">No machine selected</option>
                            {machines.map((machine) => (
                                <option key={machine.id} value={machine.id}>
                                    {machine.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="priority" className="mb-2 block text-sm font-medium text-text-primary">
                            Priority
                        </label>
                        <select
                            id="priority"
                            name="priority"
                            value={formData.priority}
                            onChange={handleChange}
                            className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                        >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                        </select>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
                        {machines.length > 0
                            ? 'The new task will appear instantly in the control system and sync over WebSocket.'
                            : 'No machines exist yet. You can still create an unassigned task, or add a machine first.'}
                    </div>

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={closeModal}
                            disabled={creatingTask}
                            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={creatingTask}
                            className="flex items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {creatingTask ? 'Creating...' : '+ Create Task'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
