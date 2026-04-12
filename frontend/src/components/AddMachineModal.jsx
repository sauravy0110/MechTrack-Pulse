import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import useAppStore from '../stores/appStore';
import { X, Plus, MapPin } from 'lucide-react';

const INITIAL_FORM = { machine_name: '', location_x: '', location_y: '', location_z: '' };
function toGridCoordinate(value) { if (value === '' || value == null) return 0; const parsed = Number(value); return Number.isFinite(parsed) ? Math.round(parsed) : 0; }

export default function AddMachineModal() {
    const closeModal = useAppStore((state) => state.closeAddMachineModal);
    const createMachine = useAppStore((state) => state.createMachine);
    const creatingMachine = useAppStore((state) => state.creatingMachine);
    const [formData, setFormData] = useState(INITIAL_FORM);
    const [error, setError] = useState('');

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape' && !creatingMachine) closeModal(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [creatingMachine, closeModal]);

    const handleChange = (e) => { setFormData((c) => ({ ...c, [e.target.name]: e.target.value })); setError(''); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const machineName = formData.machine_name.trim();
        if (!machineName) { setError('Machine name is required.'); return; }
        try {
            await createMachine({ name: machineName, grid_x: toGridCoordinate(formData.location_x), grid_y: toGridCoordinate(formData.location_z) });
            closeModal();
        } catch (err) { setError(err.message || 'Unable to create machine right now.'); }
    };

    return (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-bg-overlay px-4 py-8" onClick={closeModal}>
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="modal-shell w-full max-w-lg rounded-[30px] p-7 shadow-2xl sm:p-8"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Machine management</p>
                        <h2 className="font-display mt-2 text-3xl tracking-tight text-text-primary">Add Machine</h2>
                        <p className="mt-2 text-xs leading-6 text-text-secondary">
                            Create a machine and place it on the factory grid.
                        </p>
                    </div>
                    <button type="button" onClick={closeModal} disabled={creatingMachine}
                        className="modal-close disabled:opacity-50"><X size={14} /> Close</button>
                </div>

                {error && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                        className="mt-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger">{error}</motion.div>
                )}

                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                    <div>
                        <label htmlFor="machine_name" className="mb-1.5 block text-xs font-semibold text-text-primary">Machine name</label>
                        <input id="machine_name" name="machine_name" type="text" value={formData.machine_name} onChange={handleChange}
                            className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="CNC-01" autoFocus required />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        {[{ id: 'location_x', label: 'X' }, { id: 'location_y', label: 'Y' }, { id: 'location_z', label: 'Z' }].map((f) => (
                            <div key={f.id}>
                                <label htmlFor={f.id} className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-text-primary">
                                    <MapPin size={10} className="text-text-muted" /> {f.label}
                                </label>
                                <input id={f.id} name={f.id} type="number" value={formData[f.id]} onChange={handleChange}
                                    className="input-glass w-full rounded-xl px-4 py-3 text-sm" placeholder="0" />
                            </div>
                        ))}
                    </div>

                    <div className="glass-card rounded-xl px-4 py-3 text-xs text-text-secondary">
                        Machines sync instantly to the 3D scene over WebSocket.
                    </div>

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button type="button" onClick={closeModal} disabled={creatingMachine}
                            className="btn-ghost rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-50">Cancel</button>
                        <motion.button type="submit" disabled={creatingMachine} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                            className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                            {creatingMachine ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> :
                                <><Plus size={14} /> Add Machine</>}
                        </motion.button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
}
