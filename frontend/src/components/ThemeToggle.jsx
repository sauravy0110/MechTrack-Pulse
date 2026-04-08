import useThemeStore from '../stores/themeStore';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ className = '' }) {
    const { theme, toggle } = useThemeStore();
    const isDark = theme === 'dark';

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            className={`relative flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition-all duration-300 cursor-pointer ${
                isDark
                    ? 'bg-gold/15 text-gold border border-gold/20 hover:bg-gold/25'
                    : 'bg-accent/10 text-accent border border-accent/20 hover:bg-accent/15'
            } ${className}`}
        >
            <span className="relative w-4 h-4 flex items-center justify-center">
                <Sun
                    size={14}
                    className={`absolute transition-all duration-300 ${
                        isDark ? 'opacity-0 rotate-90 scale-0' : 'opacity-100 rotate-0 scale-100'
                    }`}
                />
                <Moon
                    size={14}
                    className={`absolute transition-all duration-300 ${
                        isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-0'
                    }`}
                />
            </span>
            <span className="hidden sm:inline">{isDark ? 'Dark' : 'Light'}</span>
        </button>
    );
}
