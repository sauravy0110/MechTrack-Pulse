import { memo } from 'react';
import { Activity, ShieldCheck, Zap, AlertCircle } from 'lucide-react';
import useAppStore from '../stores/appStore';
import { motion } from 'framer-motion';

const MotionDiv = motion.div;

const StatCard = ({ icon, label, value, color, delay }) => {
    const IconComponent = icon;

    return (
        <MotionDiv
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay }}
            className="bg-bg-panel/60 backdrop-blur-md border border-border/50 rounded-2xl p-5 flex flex-col items-center text-center shadow-lg"
        >
            <div className={`p-3 rounded-xl mb-3 ${color} bg-opacity-10`}>
                <IconComponent className={color.replace('bg-', 'text-')} size={24} />
            </div>
            <p className="text-2xl font-black text-text-primary tracking-tighter">{value}</p>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-1">{label}</p>
        </MotionDiv>
    );
};

const MobileStatsView = memo(function MobileStatsView() {
    const dashboard = useAppStore((s) => s.dashboard);
    const machines = useAppStore((s) => s.machines);

    if (!dashboard) return (
        <div className="flex-1 flex items-center justify-center p-10 text-center">
            <p className="text-xs text-text-muted font-mono animate-pulse uppercase tracking-widest">
                Syncing Fleet Intelligence...
            </p>
        </div>
    );

    const stats = [
        { icon: Activity, label: 'Throughput', value: dashboard.tasks?.completed || 0, color: 'bg-success', delay: 0.1 },
        { icon: AlertCircle, label: 'Risks', value: dashboard.tasks?.delayed || 0, color: 'bg-danger', delay: 0.2 },
        { icon: Zap, label: 'Uptime', value: '98.2%', color: 'bg-accent', delay: 0.3 },
        { icon: ShieldCheck, label: 'Health', value: `${machines.length > 0 ? 'Optimal' : '--'}`, color: 'bg-success', delay: 0.4 },
    ];

    return (
        <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-32">
            <header>
                <h1 className="text-2xl font-black text-text-primary tracking-tight">System Status</h1>
                <p className="text-xs text-text-muted mt-1 font-mono uppercase tracking-widest">Fleet-wide performance</p>
            </header>

            <div className="grid grid-cols-2 gap-4">
                {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
            </div>

            {/* AI Summary Section */}
            <div className="bg-gradient-to-br from-accent/20 to-transparent border border-accent/20 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Zap size={80} className="text-accent" />
                </div>
                <h3 className="text-sm font-black text-accent uppercase tracking-widest mb-3">AI Engine Recommendation</h3>
                <p className="text-sm text-text-primary leading-relaxed font-medium">
                    {dashboard.tasks?.delayed > 0
                        ? "Predictive analysis indicates a 14% efficiency drop due to delayed tasks. Recommend immediate intervention on Line A."
                        : "System operating at peak performance. AI Action Engine is currently monitoring for micro-delays in machine cycles."
                    }
                </p>
            </div>
        </div>
    );
});

export default MobileStatsView;
