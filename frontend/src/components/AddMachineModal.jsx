import { useEffect, useState } from 'react';
import useAppStore from '../stores/appStore';

const INITIAL_FORM = {
    machine_name: '',
    location_x: '',
    location_y: '',
    location_z: '',
};

function toGridCoordinate(value) {
    if (value === '' || value == null) {
        return 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export default function AddMachineModal() {
    const closeModal = useAppStore((state) => state.closeAddMachineModal);
    const createMachine = useAppStore((state) => state.createMachine);
    const creatingMachine = useAppStore((state) => state.creatingMachine);

    const [formData, setFormData] = useState(INITIAL_FORM);
    const [error, setError] = useState('');

    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape' && !creatingMachine) {
                closeModal();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [creatingMachine, closeModal]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((current) => ({ ...current, [name]: value }));
        setError('');
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const machineName = formData.machine_name.trim();
        if (!machineName) {
            setError('Machine name is required.');
            return;
        }

        try {
            await createMachine({
                name: machineName,
                grid_x: toGridCoordinate(formData.location_x),
                grid_y: toGridCoordinate(formData.location_z),
            });
            closeModal();
        } catch (createError) {
            setError(createError.message || 'Unable to create machine right now.');
        }
    };

    return (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.18)] px-4 py-8">
            <div className="w-full max-w-lg rounded-[32px] border border-border bg-white p-7 shadow-[0_24px_70px_rgba(15,23,42,0.12)] sm:p-8">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">Machine management</p>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">Add Machine</h2>
                        <p className="mt-3 text-sm leading-6 text-text-secondary">
                            Create a machine and place it on the factory grid. `X` and `Z` drive floor placement. `Y` is reserved for future elevation controls.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={closeModal}
                        disabled={creatingMachine}
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
                        <label htmlFor="machine_name" className="mb-2 block text-sm font-medium text-text-primary">
                            Machine name
                        </label>
                        <input
                            id="machine_name"
                            name="machine_name"
                            type="text"
                            value={formData.machine_name}
                            onChange={handleChange}
                            className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                            placeholder="CNC-01"
                            autoFocus
                            required
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                        <div>
                            <label htmlFor="location_x" className="mb-2 block text-sm font-medium text-text-primary">
                                Location X
                            </label>
                            <input
                                id="location_x"
                                name="location_x"
                                type="number"
                                value={formData.location_x}
                                onChange={handleChange}
                                className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                placeholder="0"
                            />
                        </div>

                        <div>
                            <label htmlFor="location_y" className="mb-2 block text-sm font-medium text-text-primary">
                                Location Y
                            </label>
                            <input
                                id="location_y"
                                name="location_y"
                                type="number"
                                value={formData.location_y}
                                onChange={handleChange}
                                className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                placeholder="0"
                            />
                        </div>

                        <div>
                            <label htmlFor="location_z" className="mb-2 block text-sm font-medium text-text-primary">
                                Location Z
                            </label>
                            <input
                                id="location_z"
                                name="location_z"
                                type="number"
                                value={formData.location_z}
                                onChange={handleChange}
                                className="w-full rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
                                placeholder="0"
                            />
                        </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-secondary px-4 py-3 text-sm text-text-secondary">
                        Machines created here are inserted instantly into the store and the 3D factory scene.
                    </div>

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={closeModal}
                            disabled={creatingMachine}
                            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={creatingMachine}
                            className="flex items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.24)] transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {creatingMachine ? 'Creating...' : '+ Add Machine'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
