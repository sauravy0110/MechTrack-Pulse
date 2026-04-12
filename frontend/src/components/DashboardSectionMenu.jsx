import { motion } from 'framer-motion';
import { ArrowRight, Brain, Cpu, Orbit, RadioTower } from 'lucide-react';

const ROLE_COPY = {
    owner: 'Strategic control for growth, execution, and business intelligence.',
    supervisor: 'Operational control room for assignment, monitoring, and intervention.',
    operator: 'Focused execution workspace with guided work and team visibility.',
    client: 'Clear project visibility with updates, timelines, and delivery confidence.',
};

function StatusChip({ icon: Icon, label, tone }) {
    return (
        <div className={`rounded-2xl border px-3 py-3 ${tone}`}>
            <div className="flex items-center gap-2">
                <Icon size={14} />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">{label}</span>
            </div>
        </div>
    );
}

export default function DashboardSectionMenu({
    activeSection,
    sections,
    onChange,
    user,
    wsStatus,
    aiProviderStatus,
}) {
    const aiConnected = aiProviderStatus?.enabled === true;
    const liveConnected = wsStatus === 'connected';
    const roleLabel = user?.role ? `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}` : 'Workspace';

    return (
        <aside className="premium-surface flex h-full flex-col rounded-[32px] p-4 lg:p-5">
            <div className="rounded-[28px] border border-border/70 bg-gradient-to-br from-white/75 via-white/35 to-accent/8 p-5">
                <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-white shadow-lg shadow-accent/20">
                        <Orbit size={20} />
                    </div>
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Workspace</p>
                        <h2 className="font-display text-2xl text-text-primary">Command Deck</h2>
                    </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-text-secondary">
                    {ROLE_COPY[user?.role] || 'Move through each business area one section at a time.'}
                </p>
            </div>

            <div className="mt-5">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">Sections</p>
                <div className="mt-3 flex flex-col gap-2">
                    {sections.map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSection === section.id;
                        return (
                            <motion.button
                                key={section.id}
                                type="button"
                                whileHover={{ x: 2 }}
                                whileTap={{ scale: 0.99 }}
                                onClick={() => onChange(section.id)}
                                className={`flex items-center justify-between rounded-[24px] px-4 py-3 text-left ${
                                    isActive ? 'section-pill-active' : 'section-pill'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${isActive ? 'bg-white/15' : 'bg-bg-hover/70'}`}>
                                        <Icon size={16} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold">{section.label}</p>
                                        <p className={`text-[11px] ${isActive ? 'text-white/78' : 'text-text-muted'}`}>
                                            {section.description}
                                        </p>
                                    </div>
                                </div>
                                <ArrowRight size={15} className={isActive ? 'opacity-100' : 'opacity-45'} />
                            </motion.button>
                        );
                    })}
                </div>
            </div>

            <div className="mt-auto space-y-3 pt-5">
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <StatusChip
                        icon={RadioTower}
                        label={liveConnected ? 'Live Connected' : 'Live Offline'}
                        tone={liveConnected ? 'border-success/30 bg-success/8 text-success' : 'border-danger/30 bg-danger/8 text-danger'}
                    />
                    <StatusChip
                        icon={Brain}
                        label={aiConnected ? 'AI Connected' : 'AI Unavailable'}
                        tone={aiConnected ? 'border-success/30 bg-success/8 text-success' : 'border-danger/30 bg-danger/8 text-danger'}
                    />
                </div>

                <div className="rounded-[24px] border border-border/70 bg-bg-hover/70 px-4 py-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-muted">{roleLabel}</p>
                    <div className="mt-2 flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/14 text-sm font-bold uppercase text-gold">
                            {user?.full_name?.charAt(0) || 'M'}
                        </div>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-text-primary">{user?.full_name}</p>
                            <p className="truncate text-xs text-text-muted">{user?.email}</p>
                        </div>
                    </div>
                </div>

                <div className="rounded-[24px] border border-border/70 bg-gradient-to-br from-accent/10 via-transparent to-gold/8 px-4 py-4">
                    <div className="flex items-center gap-2 text-accent">
                        <Cpu size={14} />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em]">Decluttered Mode</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                        Each section now opens its full workspace separately so the screen stays focused and easier to use.
                    </p>
                </div>
            </div>
        </aside>
    );
}
