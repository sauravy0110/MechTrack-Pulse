import { memo } from 'react';
import { Home, ClipboardList, BarChart2, User } from 'lucide-react';

const MobileBottomNav = memo(function MobileBottomNav({ activeTab, setActiveTab }) {
    const tabs = [
        { id: 'factory', label: 'Factory', icon: Home },
        { id: 'tasks', label: 'Tasks', icon: ClipboardList },
        { id: 'stats', label: 'Stats', icon: BarChart2 },
        { id: 'profile', label: 'Profile', icon: User },
    ];

    return (
        <nav className="fixed bottom-0 left-0 right-0 bg-bg-panel/80 backdrop-blur-xl border-t border-border px-6 py-3 flex justify-between items-center z-50 transition-all duration-300 md:hidden">
            {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`group relative flex flex-col items-center gap-1.5 focus:outline-none transition-all duration-200 ${isActive ? 'scale-110' : 'opacity-60 grayscale'
                            }`}
                    >
                        <div className={`p-2 rounded-xl transition-all duration-300 ${isActive ? 'bg-accent/20 text-accent shadow-[0_0_20px_rgba(var(--accent-rgb),0.2)]' : 'text-text-muted hover:text-text-primary'
                            }`}>
                            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                        </div>
                        <span className={`text-[10px] font-bold tracking-tight uppercase transition-colors duration-200 ${isActive ? 'text-accent' : 'text-text-muted'
                            }`}>
                            {tab.label}
                        </span>

                        {isActive && (
                            <div className="absolute -top-1 w-1 h-1 bg-accent rounded-full animate-pulse shadow-[0_0_8px_var(--accent)]" />
                        )}
                    </button>
                );
            })}
        </nav>
    );
});

export default MobileBottomNav;
