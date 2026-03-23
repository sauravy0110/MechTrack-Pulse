import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function HeroVisual() {
    const groupRef = useRef();
    const ringRef = useRef();

    useFrame((state) => {
        const time = state.clock.elapsedTime;

        if (groupRef.current) {
            groupRef.current.rotation.y = time * 0.18;
            groupRef.current.rotation.x = Math.sin(time * 0.14) * 0.08;
        }

        if (ringRef.current) {
            ringRef.current.rotation.z = time * 0.32;
        }
    });

    return (
        <group>
            <group ref={groupRef}>
                <mesh>
                    <boxGeometry args={[2.2, 2.2, 2.2]} />
                    <meshStandardMaterial color="#ffffff" emissive="#3b82f6" emissiveIntensity={0.12} wireframe />
                </mesh>
                <mesh>
                    <boxGeometry args={[1.4, 1.4, 1.4]} />
                    <meshStandardMaterial color="#ffffff" emissive="#d4af37" emissiveIntensity={0.14} wireframe />
                </mesh>
            </group>

            <mesh ref={ringRef} rotation-x={Math.PI / 2}>
                <ringGeometry args={[3.1, 3.14, 80]} />
                <meshBasicMaterial color="#3b82f6" opacity={0.22} transparent side={THREE.DoubleSide} />
            </mesh>

            <mesh rotation-x={Math.PI / 3} rotation-y={Math.PI / 6}>
                <ringGeometry args={[3.75, 3.79, 80]} />
                <meshBasicMaterial color="#d4af37" opacity={0.18} transparent side={THREE.DoubleSide} />
            </mesh>

            <ambientLight intensity={0.9} />
            <pointLight position={[6, 8, 6]} intensity={1} color="#ffffff" />
            <pointLight position={[-6, -4, -8]} intensity={0.5} color="#3b82f6" />
        </group>
    );
}

const STATS = [
    { label: 'Real-time sync', value: '< 50ms' },
    { label: 'Approvals', value: 'Admin console' },
    { label: 'Coverage', value: 'Multi-tenant' },
];

const FEATURES = [
    {
        title: 'Factory operations',
        description: 'Operators, planners, and supervisors work from the same live production view.',
    },
    {
        title: 'Fast onboarding',
        description: 'New companies can register publicly and now be approved from a dedicated admin flow.',
    },
    {
        title: 'Premium clarity',
        description: 'Clean light surfaces keep high-signal data readable on laptops, tablets, and plant-floor stations.',
    },
];

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-bg-primary text-text-primary selection:bg-accent/20 selection:text-text-primary">
            <div
                className="pointer-events-none fixed inset-0"
                style={{
                    background: 'linear-gradient(180deg, #ffffff 0%, #f9fafb 50%, #eef4ff 100%)',
                }}
            />
            <div
                className="pointer-events-none fixed inset-0 opacity-70"
                style={{
                    backgroundImage: 'radial-gradient(rgba(59,130,246,0.08) 1px, transparent 1px)',
                    backgroundSize: '28px 28px',
                }}
            />

            <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-12">
                <nav className="flex items-center justify-between rounded-full border border-border bg-white/90 px-5 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_10px_24px_rgba(59,130,246,0.22)]">
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-lg font-semibold tracking-tight">MechTrack Pulse</p>
                            <p className="text-sm text-text-secondary">Manufacturing control platform</p>
                        </div>
                    </div>

                    <div className="hidden items-center gap-3 md:flex">
                        <Link to="/login" className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:border-accent hover:text-accent">
                            User Login
                        </Link>
                        <Link to="/admin/login" className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-text-primary shadow-[0_10px_22px_rgba(212,175,55,0.18)] transition hover:brightness-105">
                            Admin Login
                        </Link>
                        <Link to="/register" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.22)] transition hover:bg-accent-glow">
                            Register Company
                        </Link>
                    </div>
                </nav>

                <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
                    <div className="rounded-[36px] border border-border bg-white p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-10">
                        <div className="inline-flex items-center rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-accent">
                            Live factory control
                        </div>
                        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                            One system for operators and platform admins.
                        </h1>
                        <p className="mt-6 max-w-2xl text-base leading-7 text-text-secondary sm:text-lg">
                            Monitor machines, track task risk, onboard new companies, and approve access from a calmer interface designed for daily use.
                        </p>

                        <div className="mt-8 flex flex-wrap gap-3">
                            <Link
                                to="/login"
                                className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(59,130,246,0.22)] transition hover:bg-accent-glow"
                            >
                                User Login
                            </Link>
                            <Link
                                to="/admin/login"
                                className="rounded-full bg-gold px-6 py-3 text-sm font-semibold text-text-primary shadow-[0_12px_26px_rgba(212,175,55,0.18)] transition hover:brightness-105"
                            >
                                Admin Login
                            </Link>
                            <Link
                                to="/register"
                                className="rounded-full border border-border px-6 py-3 text-sm font-medium text-text-primary transition hover:border-accent hover:text-accent"
                            >
                                Register a company
                            </Link>
                        </div>

                        <div className="mt-10 grid gap-4 sm:grid-cols-3">
                            {STATS.map((item) => (
                                <div key={item.label} className="rounded-3xl border border-border bg-bg-secondary p-5">
                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{item.label}</p>
                                    <p className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">{item.value}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-[36px] border border-border bg-white p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:p-6">
                        <div className="flex items-center justify-between rounded-3xl border border-border bg-bg-secondary px-5 py-4">
                            <div>
                                <p className="text-sm font-semibold text-text-primary">System view</p>
                                <p className="mt-1 text-sm text-text-secondary">Live, responsive, and easier to approve from.</p>
                            </div>
                            <div className="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-gold">
                                Premium light
                            </div>
                        </div>
                        <div className="mt-4 h-[420px] overflow-hidden rounded-[30px] bg-[linear-gradient(180deg,#eff6ff_0%,#ffffff_100%)]">
                            <Canvas camera={{ position: [5, 4, 7], fov: 45 }}>
                                <HeroVisual />
                                <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.45} />
                            </Canvas>
                        </div>
                    </div>
                </section>

                <section className="grid gap-6 pb-10 md:grid-cols-3">
                    {FEATURES.map((feature) => (
                        <article
                            key={feature.title}
                            className="rounded-[30px] border border-border bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]"
                        >
                            <div className="h-10 w-10 rounded-2xl bg-accent/10" />
                            <h2 className="mt-5 text-xl font-semibold tracking-tight text-text-primary">{feature.title}</h2>
                            <p className="mt-3 text-sm leading-6 text-text-secondary">{feature.description}</p>
                        </article>
                    ))}
                </section>
            </div>
        </div>
    );
}
