import { create } from 'zustand';

const getInitialTheme = () => {
    const stored = localStorage.getItem('mechtrack-theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'dark' ? '#071218' : '#f6f3ed');
};

// Apply immediately on load
const initialTheme = getInitialTheme();
applyTheme(initialTheme);

const useThemeStore = create((set) => ({
    theme: initialTheme,
    toggle: () => set((state) => {
        const next = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('mechtrack-theme', next);
        applyTheme(next);
        return { theme: next };
    }),
    setTheme: (theme) => {
        localStorage.setItem('mechtrack-theme', theme);
        applyTheme(theme);
        set({ theme });
    },
    isDark: () => {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    },
}));

export default useThemeStore;
