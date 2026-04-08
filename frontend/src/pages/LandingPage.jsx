import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Float } from '@react-three/drei';
import { motion, useInView } from 'framer-motion';
import * as THREE from 'three';
import ThemeToggle from '../components/ThemeToggle';
import useThemeStore from '../stores/themeStore';
import { Factory, Shield, Zap, Users, ArrowRight, Play } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   3D HERO VISUAL — Animated industrial geometry
   ═══════════════════════════════════════════════════════════ */
function HeroVisual() {
    const groupRef = useRef();
    const ringRef = useRef();
    const torusRef = useRef();

    useFrame((state) => {
        const time = state.clock.elapsedTime;
        if (groupRef.current) {
            groupRef.current.rotation.y = time * 0.15;
            groupRef.current.rotation.x = Math.sin(time * 0.12) * 0.06;
        }
        if (ringRef.current) {
            ringRef.current.rotation.z = time * 0.25;
        }
        if (torusRef.current) {
            torusRef.current.rotation.x = time * 0.2;
            torusRef.current.rotation.y = time * 0.15;
        }
    });

    return (
        <group>
            <group ref={groupRef}>
                <mesh>
                    <icosahedronGeometry args={[1.8, 1]} />
                    <meshStandardMaterial
                        color="#818cf8"
                        emissive="#6366f1"
                        emissiveIntensity={0.15}
                        wireframe
                        transparent
                        opacity={0.7}
                    />
                </mesh>
                <mesh>
                    <octahedronGeometry args={[1.2, 0]} />
                    <meshStandardMaterial
                        color="#fbbf24"
                        emissive="#f59e0b"
                        emissiveIntensity={0.12}
                        wireframe
                        transparent
                        opacity={0.5}
                    />
                </mesh>
                <mesh scale={0.4}>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshStandardMaterial
                        color="#ffffff"
                        emissive="#818cf8"
                        emissiveIntensity={0.3}
                    />
                </mesh>
            </group>

            <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.5}>
                <mesh ref={torusRef} position={[3, 1.5, -1]}>
                    <torusKnotGeometry args={[0.5, 0.15, 64, 8]} />
                    <meshStandardMaterial
                        color="#818cf8"
                        emissive="#6366f1"
                        emissiveIntensity={0.2}
                        wireframe
                        transparent
                        opacity={0.4}
                    />
                </mesh>
            </Float>

            <mesh ref={ringRef} rotation-x={Math.PI / 2}>
                <torusGeometry args={[3.2, 0.02, 16, 100]} />
                <meshBasicMaterial color="#818cf8" transparent opacity={0.3} />
            </mesh>

            <mesh rotation-x={Math.PI / 3} rotation-y={Math.PI / 6}>
                <torusGeometry args={[3.8, 0.015, 16, 100]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.2} />
            </mesh>

            <mesh rotation-x={Math.PI / 4} rotation-z={Math.PI / 5}>
                <torusGeometry args={[4.2, 0.01, 16, 100]} />
                <meshBasicMaterial color="#818cf8" transparent opacity={0.1} />
            </mesh>

            <ambientLight intensity={0.6} />
            <pointLight position={[6, 8, 6]} intensity={1.2} color="#ffffff" />
            <pointLight position={[-6, -4, -8]} intensity={0.6} color="#818cf8" />
            <pointLight position={[0, 5, 0]} intensity={0.3} color="#fbbf24" />
        </group>
    );
}

/* ═══════════════════════════════════════════════════════════
   FLOATING PARTICLES — CSS animated background
   ═══════════════════════════════════════════════════════════ */
function FloatingParticles() {
    return (
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
            {Array.from({ length: 20 }).map((_, i) => (
                <div
                    key={i}
                    className="absolute w-1 h-1 rounded-full bg-accent/20"
                    style={{
                        left: `${Math.random() * 100}%`,
                        top: `${Math.random() * 100}%`,
                        animation: `particle-drift ${12 + Math.random() * 20}s linear infinite`,
                        animationDelay: `${Math.random() * 10}s`,
                    }}
                />
            ))}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   ANIMATION VARIANTS
   ═══════════════════════════════════════════════════════════ */
const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

const fadeIn = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: 0.8 } },
};

const scaleUp = {
    hidden: { opacity: 0, scale: 0.9 },
    show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

/* ═══════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════ */
const STATS = [
    { label: 'Real-time sync', value: '< 50ms', icon: Zap },
    { label: 'Platform', value: 'Multi-tenant', icon: Shield },
    { label: 'Team access', value: 'Role-based', icon: Users },
];

const FEATURES = [
    {
        title: 'Live Factory Control',
        description: 'Operators, planners, and supervisors work from the same 3D production view with real-time WebSocket updates.',
        icon: Factory,
        gradient: 'from-accent/20 to-accent/5',
    },
    {
        title: 'Instant Onboarding',
        description: 'Companies register publicly and get approved from a dedicated admin dashboard with temporary password flow.',
        icon: Users,
        gradient: 'from-gold/20 to-gold/5',
    },
    {
        title: 'AI-Powered Insights',
        description: 'Predictive delay analysis, smart operator assignment, and real-time risk visualization across the factory floor.',
        icon: Zap,
        gradient: 'from-success/20 to-success/5',
    },
];

/* ═══════════════════════════════════════════════════════════
   ANIMATED SECTION COMPONENT
   ═══════════════════════════════════════════════════════════ */
function AnimatedSection({ children, className = '' }) {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: '-50px' });

    return (
        <motion.div
            ref={ref}
            initial="hidden"
            animate={isInView ? 'show' : 'hidden'}
            variants={stagger}
            className={className}
        >
            {children}
        </motion.div>
    );
}

/* ═══════════════════════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════════════════════ */
export default function LandingPage() {
    const theme = useThemeStore((s) => s.theme);
    const isDark = theme === 'dark';

    return (
        <div className="min-h-screen text-text-primary selection:bg-accent/20">
            {/* Animated background layers */}
            <div className="pointer-events-none fixed inset-0 bg-mesh z-0" />
            <div className="pointer-events-none fixed inset-0 bg-dot-pattern opacity-40 z-0" />
            <FloatingParticles />

            {/* Video background — subtle factory footage */}
            <div className="video-bg-container">
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    poster=""
                >
                    <source
                        src="https://cdn.coverr.co/videos/coverr-robotic-arms-in-a-factory-1944/1080p.mp4"
                        type="video/mp4"
                    />
                </video>
                <div className="video-bg-overlay" />
            </div>

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
                {/* ── NAV ─────────────────────────────────────── */}
                <motion.nav
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="glass-strong flex items-center justify-between rounded-2xl px-5 py-3 shadow-lg"
                >
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white glow-accent">
                            <Factory size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-bold tracking-tight">MechTrack Pulse</p>
                            <p className="text-[10px] text-text-muted font-mono uppercase tracking-widest">Factory Control</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <Link to="/login" className="hidden sm:inline-flex btn-ghost rounded-full px-4 py-2 text-xs font-medium">
                            User Login
                        </Link>
                        <Link to="/admin/login" className="hidden md:inline-flex btn-gold rounded-full px-4 py-2 text-xs font-semibold">
                            Admin
                        </Link>
                        <Link to="/register" className="btn-primary rounded-full px-4 py-2 text-xs font-semibold">
                            Register
                        </Link>
                    </div>
                </motion.nav>

                {/* ── HERO ────────────────────────────────────── */}
                <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-12">
                    <AnimatedSection>
                        <motion.div
                            variants={fadeUp}
                            className="glass-strong rounded-3xl p-7 sm:p-9"
                        >
                            <motion.div
                                variants={fadeUp}
                                className="inline-flex items-center gap-2 rounded-full bg-accent/10 border border-accent/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-accent"
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                Live factory control
                            </motion.div>

                            <motion.h1
                                variants={fadeUp}
                                className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl leading-[1.1]"
                            >
                                <span className="gradient-text">One system</span> for operators{' '}
                                <br className="hidden sm:block" />
                                and platform admins.
                            </motion.h1>

                            <motion.p variants={fadeUp} className="mt-5 max-w-xl text-sm leading-7 text-text-secondary sm:text-base">
                                Monitor machines in 3D, track task risk with AI, onboard companies, and manage access from a premium interface designed for daily use.
                            </motion.p>

                            <motion.div variants={fadeUp} className="mt-7 flex flex-wrap gap-3">
                                <Link
                                    to="/login"
                                    className="btn-primary rounded-full px-6 py-3 text-sm font-semibold inline-flex items-center gap-2"
                                >
                                    Open Dashboard <ArrowRight size={14} />
                                </Link>
                                <Link
                                    to="/admin/login"
                                    className="btn-gold rounded-full px-6 py-3 text-sm font-semibold"
                                >
                                    Admin Login
                                </Link>
                                <Link
                                    to="/register"
                                    className="btn-ghost rounded-full px-6 py-3 text-sm font-medium"
                                >
                                    Register Company
                                </Link>
                            </motion.div>

                            <motion.div variants={stagger} className="mt-8 grid gap-3 sm:grid-cols-3">
                                {STATS.map((item, i) => (
                                    <motion.div
                                        key={item.label}
                                        variants={scaleUp}
                                        className="glass-card rounded-2xl p-4 text-center group"
                                    >
                                        <item.icon size={16} className="mx-auto text-accent mb-2 group-hover:scale-110 transition-transform" />
                                        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-text-muted">{item.label}</p>
                                        <p className="mt-1 text-lg font-bold tracking-tight text-text-primary">{item.value}</p>
                                    </motion.div>
                                ))}
                            </motion.div>
                        </motion.div>
                    </AnimatedSection>

                    <AnimatedSection>
                        <motion.div variants={scaleUp} className="glass-strong rounded-3xl p-4 sm:p-5">
                            <div className="flex items-center justify-between rounded-2xl glass-card px-4 py-3">
                                <div>
                                    <p className="text-xs font-bold text-text-primary">3D Factory View</p>
                                    <p className="mt-0.5 text-[10px] text-text-muted">Interactive • Real-time • WebGL</p>
                                </div>
                                <div className="rounded-full bg-accent/10 border border-accent/20 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-accent">
                                    Live
                                </div>
                            </div>
                            <div className="mt-3 h-[380px] sm:h-[420px] overflow-hidden rounded-2xl"
                                style={{ background: isDark
                                    ? 'linear-gradient(180deg, #0c1021 0%, #131836 100%)'
                                    : 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)'
                                }}
                            >
                                <Canvas
                                    dpr={[1, 1.5]}
                                    gl={{ powerPreference: 'high-performance', antialias: true }}
                                    camera={{ position: [5, 4, 7], fov: 45 }}
                                >
                                    <HeroVisual />
                                    <OrbitControls
                                        enableZoom={false}
                                        enablePan={false}
                                        autoRotate
                                        autoRotateSpeed={0.5}
                                    />
                                </Canvas>
                            </div>
                        </motion.div>
                    </AnimatedSection>
                </section>

                {/* ── FEATURES ────────────────────────────────── */}
                <AnimatedSection className="grid gap-5 pb-10 md:grid-cols-3">
                    {FEATURES.map((feature, i) => (
                        <motion.article
                            key={feature.title}
                            variants={fadeUp}
                            whileHover={{ y: -4, transition: { duration: 0.2 } }}
                            className="glass-card tilt-card rounded-2xl p-6 group cursor-default"
                        >
                            <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                                <feature.icon size={18} className="text-accent" />
                            </div>
                            <h2 className="mt-4 text-lg font-bold tracking-tight text-text-primary">
                                {feature.title}
                            </h2>
                            <p className="mt-2 text-sm leading-6 text-text-secondary">
                                {feature.description}
                            </p>
                        </motion.article>
                    ))}
                </AnimatedSection>

                {/* ── FOOTER ─────────────────────────────────── */}
                <footer className="py-6 border-t border-border text-center">
                    <p className="text-[10px] text-text-muted font-mono uppercase tracking-widest">
                        MechTrack Pulse · Premium Factory Control · © {new Date().getFullYear()}
                    </p>
                </footer>
            </div>
        </div>
    );
}
