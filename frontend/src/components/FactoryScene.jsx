/**
 * MechTrack Pulse — Optimized 3D Factory Scene
 *
 * PART 1: InstancedMesh — single draw call for ALL machine bodies + lights
 * PART 2: Pulse effect — sine breathing for delayed machines
 * PART 3: Camera focus — smooth lerp to selected machine
 * PART 4: Hover tooltip — debounced HTML overlay with task info
 * PART 5: Real-time — only changed instance matrices/colors updated
 * PART 6: Visual polish — fog, soft shadows, active glow
 * PART 7: Loading + empty states — skeleton + "No machines" fallback
 * PART 8: Responsive — mobile fallback (2D), tablet simplified
 */

import { memo, useRef, useMemo, useState, useCallback, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import useAppStore from '../stores/appStore';
import useAuthStore from '../stores/authStore';
import useThemeStore from '../stores/themeStore';
import { playClickSound } from '../utils/audio';

// ── Constants ───────────────────────────────────────────────
const GRID_SPACING = 4;
const GRID_OFFSET = 5; // center offset

const STATUS_COLORS = {
    completed: new THREE.Color(0x22c55e),
    in_progress: new THREE.Color(0xeab308),
    delayed: new THREE.Color(0xef4444),
    idle: new THREE.Color(0x4b5563),
};

const STATUS_EMISSIVE_INTENSITY = {
    completed: 0.15,
    in_progress: 0.25,
    delayed: 0.6,
    idle: 0.0,
};

// Shared geometry + material (allocated once, reused across renders)
const _boxGeo = new THREE.BoxGeometry(2, 1.2, 2);
const _lightGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8);
const _barGeo = new THREE.BoxGeometry(1, 0.08, 0.08); // Load bar
const _haloGeo = new THREE.RingGeometry(1.5, 1.7, 32);
_haloGeo.rotateX(-Math.PI / 2); // Flat on floor

const _tempMatrix = new THREE.Matrix4();
const _tempColor = new THREE.Color();
const _tempVec3 = new THREE.Vector3();
const _tempScale = new THREE.Vector3();

const getRiskColor = (risk) => {
    if (risk < 0.3) return STATUS_COLORS.completed;
    if (risk < 0.7) return STATUS_COLORS.in_progress;
    return STATUS_COLORS.delayed;
};

// ─────────────────────────────────────────────────────────────
// PART 1: InstancedMachines — single draw call for all machines
// ─────────────────────────────────────────────────────────────
const InstancedMachines = memo(function InstancedMachines({ machineData, onSelect, onHover, selectedId }) {
    const bodyRef = useRef();
    const lightRef = useRef();
    const haloRef = useRef();
    const barRef = useRef();
    const count = machineData.length;

    // Reusable material with per-instance color support
    const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        roughness: 0.45,
        metalness: 0.35,
    }), []);

    const lightMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        roughness: 0.3,
        metalness: 0.1,
    }), []);

    const haloMaterial = useMemo(() => new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
    }), []);

    const barMaterial = useMemo(() => new THREE.MeshBasicMaterial({
        color: 0xffffff,
    }), []);

    // ── Per-frame update: positions, colors, pulse ─────────
    useFrame((state) => {
        if (!bodyRef.current || !lightRef.current || count === 0) return;

        const elapsed = state.clock.elapsedTime;

        for (let i = 0; i < count; i++) {
            const { position, status, id } = machineData[i];
            const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
            const isSelected = id === selectedId;

            // ── PART 2: Pulse breathing for delayed ────────────
            let scale = 1;
            if (status === 'delayed') {
                // Slow sine breathing: ±8% over 2 seconds
                scale = 1 + Math.sin(elapsed * 2.0 + i * 0.5) * 0.08;
            }

            // Selection subtle pop
            if (isSelected) {
                scale *= 1.05;
            }

            // Body matrix
            _tempMatrix.makeScale(scale, scale, scale);
            _tempMatrix.setPosition(position[0], position[1], position[2]);
            bodyRef.current.setMatrixAt(i, _tempMatrix);

            // Body color + emissive via instance color
            // (emissive handled via material; instance color drives base)
            _tempColor.copy(color);
            if (isSelected) {
                // Brighten selected machine slightly
                _tempColor.lerp(new THREE.Color(0xffffff), 0.15);
            }
            bodyRef.current.setColorAt(i, _tempColor);

            // Light position (above machine body)
            _tempMatrix.makeScale(1, 1, 1);
            _tempMatrix.setPosition(position[0], position[1] + 0.9, position[2]);
            lightRef.current.setMatrixAt(i, _tempMatrix);

            // Light color — brighter for active/delayed states
            _tempColor.copy(color);
            if (status === 'delayed') {
                // Red glow pulsing for indicator light
                const glow = 0.5 + Math.sin(elapsed * 3.0 + i) * 0.5;
                _tempColor.multiplyScalar(0.5 + glow);
            } else if (status === 'in_progress') {
                _tempColor.multiplyScalar(1.2);
            }
            lightRef.current.setColorAt(i, _tempColor);

            // Halo matrix (AI Predictive Visual)
            let haloScale = 1;
            if (machineData[i].risk > 0.7) {
                // Pulse halo size for high risk
                haloScale = 1 + Math.sin(elapsed * 4.0 + i) * 0.15;
            }
            _tempMatrix.makeScale(haloScale, haloScale, haloScale);
            _tempMatrix.setPosition(position[0], position[1] - 0.58, position[2]); // Just above ground grid
            haloRef.current.setMatrixAt(i, _tempMatrix);

            // Halo color (Gradient based on risk)
            _tempColor.copy(getRiskColor(machineData[i].risk));
            if (machineData[i].risk > 0.7) {
                // Blinking effect for high risk
                const blink = 0.5 + Math.sin(elapsed * 8.0) * 0.5;
                _tempColor.multiplyScalar(0.5 + blink * 0.5);
            }
            haloRef.current.setColorAt(i, _tempColor);

            // Bar matrix (Operator Load Visual - PART 3)
            let loadWidth = Math.min(machineData[i].taskCount * 0.4, 1.8);
            if (loadWidth === 0) loadWidth = 0.05; // almost invisible
            _tempMatrix.makeScale(loadWidth, 1, 1);
            _tempMatrix.setPosition(position[0], position[1] + 1.25, position[2]);
            barRef.current.setMatrixAt(i, _tempMatrix);

            // Bar color based on workload
            if (machineData[i].taskCount > 3) _tempColor.setHex(0xef4444);
            else if (machineData[i].taskCount > 1) _tempColor.setHex(0xeab308);
            else _tempColor.setHex(0x3b82f6);
            if (loadWidth === 0.05) _tempColor.setHex(0x1a2333); // empty state
            barRef.current.setColorAt(i, _tempColor);
        }

        bodyRef.current.instanceMatrix.needsUpdate = true;
        bodyRef.current.instanceColor.needsUpdate = true;
        lightRef.current.instanceMatrix.needsUpdate = true;
        lightRef.current.instanceColor.needsUpdate = true;
        if (haloRef.current) {
            haloRef.current.instanceMatrix.needsUpdate = true;
            haloRef.current.instanceColor.needsUpdate = true;
        }
        if (barRef.current) {
            barRef.current.instanceMatrix.needsUpdate = true;
            barRef.current.instanceColor.needsUpdate = true;
        }
    });

    // ── Initialize instance colors on first render ─────────
    useEffect(() => {
        if (!bodyRef.current || !lightRef.current || count === 0) return;

        for (let i = 0; i < count; i++) {
            const { position, status } = machineData[i];
            const color = STATUS_COLORS[status] || STATUS_COLORS.idle;

            _tempMatrix.makeScale(1, 1, 1);
            _tempMatrix.setPosition(position[0], position[1], position[2]);
            bodyRef.current.setMatrixAt(i, _tempMatrix);
            bodyRef.current.setColorAt(i, color);

            _tempMatrix.setPosition(position[0], position[1] + 0.9, position[2]);
            lightRef.current.setMatrixAt(i, _tempMatrix);
            lightRef.current.setColorAt(i, color);

            _tempMatrix.makeScale(1, 1, 1);
            _tempMatrix.setPosition(position[0], position[1] - 0.58, position[2]);
            if (haloRef.current) {
                haloRef.current.setMatrixAt(i, _tempMatrix);
                haloRef.current.setColorAt(i, getRiskColor(machineData[i].risk || 0));
            }

            let loadWidth = Math.min(machineData[i].taskCount * 0.4, 1.8) || 0.05;
            _tempMatrix.makeScale(loadWidth, 1, 1);
            _tempMatrix.setPosition(position[0], position[1] + 1.25, position[2]);
            if (barRef.current) {
                barRef.current.setMatrixAt(i, _tempMatrix);
                barRef.current.setColorAt(i, new THREE.Color(0x1a2333));
            }
        }

        bodyRef.current.instanceMatrix.needsUpdate = true;
        bodyRef.current.instanceColor.needsUpdate = true;
        lightRef.current.instanceMatrix.needsUpdate = true;
        lightRef.current.instanceColor.needsUpdate = true;
        if (haloRef.current) {
            haloRef.current.instanceMatrix.needsUpdate = true;
            haloRef.current.instanceColor.needsUpdate = true;
        }
        if (barRef.current) {
            barRef.current.instanceMatrix.needsUpdate = true;
            barRef.current.instanceColor.needsUpdate = true;
        }
    }, [count, machineData]);

    // ── Pointer events (raycast on instanced mesh) ────────
    const handlePointerMove = useCallback((e) => {
        e.stopPropagation();
        const idx = e.instanceId;
        if (idx !== undefined && idx < machineData.length) {
            document.body.style.cursor = 'pointer';
            onHover(machineData[idx], e.point);
        }
    }, [machineData, onHover]);

    const handlePointerOut = useCallback(() => {
        document.body.style.cursor = 'auto';
        onHover(null, null);
    }, [onHover]);

    const handleClick = useCallback((e) => {
        e.stopPropagation();
        const idx = e.instanceId;
        if (idx !== undefined && idx < machineData.length) {
            onSelect(machineData[idx]);
        }
    }, [machineData, onSelect]);

    if (count === 0) return null;

    return (
        <>
            {/* Machine bodies — single draw call */}
            <instancedMesh
                ref={bodyRef}
                args={[_boxGeo, bodyMaterial, count]}
                castShadow
                onClick={handleClick}
                onPointerMove={handlePointerMove}
                onPointerOut={handlePointerOut}
            />
            {/* Indicator lights — single draw call */}
            <instancedMesh
                ref={lightRef}
                args={[_lightGeo, lightMaterial, count]}
            />
            {/* Halo rings — single draw call */}
            <instancedMesh
                ref={haloRef}
                args={[_haloGeo, haloMaterial, count]}
            />
            {/* Operator load bars — single draw call */}
            <instancedMesh
                ref={barRef}
                args={[_barGeo, barMaterial, count]}
            />
        </>
    );
});

// ─────────────────────────────────────────────────────────────
// PART 2: Task Flow Animation (Flowing particles)
// ─────────────────────────────────────────────────────────────
const FlowLines = memo(function FlowLines({ activeMachines }) {
    const meshRef = useRef();
    const dotsPerMachine = 6;
    const count = activeMachines.length * dotsPerMachine;

    const dotGeo = useMemo(() => new THREE.SphereGeometry(0.06, 8, 8), []);
    const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff }), []);

    useFrame((state) => {
        if (!meshRef.current || count === 0) return;
        const time = state.clock.elapsedTime;

        let idx = 0;
        activeMachines.forEach((m) => {
            const startX = 0, startY = -0.4, startZ = 0;
            const endX = m.position[0], endY = m.position[1] - 0.4, endZ = m.position[2];
            const midX = (startX + endX) / 2;
            const midZ = (startZ + endZ) / 2;
            const ctrlY = 2.5; // Arc height

            for (let i = 0; i < dotsPerMachine; i++) {
                // Flow progress from 0 to 1
                let progress = ((time * 0.4) + (i / dotsPerMachine)) % 1.0;

                // Bezier interpolation
                const t = progress;
                const u = 1 - t;
                const tt = t * t;
                const uu = u * u;

                const x = uu * startX + 2 * u * t * midX + tt * endX;
                const y = uu * startY + 2 * u * t * ctrlY + tt * endY;
                const z = uu * startZ + 2 * u * t * midZ + tt * endZ;

                _tempMatrix.makeTranslation(x, y, z);

                // Fade out dot (size) as it reaches end
                const scale = Math.sin(progress * Math.PI) * (m.risk > 0.7 ? 1.5 : 1.0);
                const scaleMat = new THREE.Matrix4().makeScale(scale, scale, scale);
                _tempMatrix.multiply(scaleMat);

                meshRef.current.setMatrixAt(idx, _tempMatrix);

                // Color based on risk
                _tempColor.copy(getRiskColor(m.risk || 0.1));
                if (m.risk > 0.7) _tempColor.multiplyScalar(1.5);
                meshRef.current.setColorAt(idx, _tempColor);

                idx++;
            }
        });

        meshRef.current.instanceMatrix.needsUpdate = true;
        meshRef.current.instanceColor.needsUpdate = true;
    });

    if (count === 0) return null;

    return <instancedMesh ref={meshRef} args={[dotGeo, dotMat, count]} />;
});

// ─────────────────────────────────────────────────────────────
// PART 1B: Predictive Indicators (Floating HTML)
// ─────────────────────────────────────────────────────────────
const PredictiveIndicators = memo(function PredictiveIndicators({ machineData }) {
    return (
        <group>
            {machineData.map((m) => {
                if (!m.risk) return null; // Only show if risk > 0

                const isHighRisk = m.risk > 0.7;
                return (
                    <Html
                        key={`risk-${m.id}`}
                        position={[m.position[0], m.position[1] + 1.8, m.position[2]]}
                        center
                        style={{ pointerEvents: 'none', transition: 'opacity 0.2s', zIndex: 10 }}
                    >
                        <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold border whitespace-nowrap shadow-lg backdrop-blur-md flex items-center gap-1 ${isHighRisk ? 'bg-danger/20 border-danger/50 text-danger animate-pulse-danger' :
                            m.risk > 0.3 ? 'bg-warning/20 border-warning/50 text-warning' :
                                'bg-success/20 border-success/50 text-success'
                            }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${isHighRisk ? 'bg-danger' : m.risk > 0.3 ? 'bg-warning' : 'bg-success'}`} />
                            {(m.risk * 100).toFixed(0)}% Risk
                        </div>
                    </Html>
                );
            })}
        </group>
    );
});

// ─────────────────────────────────────────────────────────────
// PART 3: Camera Focus System — smooth lerp to selected machine
// ─────────────────────────────────────────────────────────────
function CameraController({ targetPosition }) {
    const { camera } = useThree();
    const controlsRef = useRef();
    const targetRef = useRef(new THREE.Vector3(0, 0, 0));
    const cameraTargetRef = useRef(new THREE.Vector3(15, 12, 15));
    const isAnimating = useRef(false);

    useEffect(() => {
        if (targetPosition) {
            // Focus: position camera offset from the target machine
            targetRef.current.set(targetPosition[0], 0, targetPosition[2]);
            cameraTargetRef.current.set(
                targetPosition[0] + 8,
                6,
                targetPosition[2] + 8,
            );
            isAnimating.current = true;
        } else {
            // Reset to overview
            targetRef.current.set(0, 0, 0);
            cameraTargetRef.current.set(15, 12, 15);
            isAnimating.current = true;
        }
    }, [targetPosition]);

    useFrame(() => {
        if (!isAnimating.current || !controlsRef.current) return;

        // Lerp camera position
        camera.position.lerp(cameraTargetRef.current, 0.04);

        // Lerp orbit target
        controlsRef.current.target.lerp(targetRef.current, 0.04);
        controlsRef.current.update();

        // Stop animating when close enough
        const dist = camera.position.distanceTo(cameraTargetRef.current);
        if (dist < 0.05) {
            isAnimating.current = false;
        }
    });

    return (
        <OrbitControls
            ref={controlsRef}
            enablePan
            enableZoom
            enableRotate
            maxPolarAngle={Math.PI / 2.2}
            minDistance={3}
            maxDistance={40}
            dampingFactor={0.05}
            enableDamping
        />
    );
}

// ─────────────────────────────────────────────────────────────
// PART 4: Hover Tooltip — HTML overlay with machine + task info
// ─────────────────────────────────────────────────────────────
const HoverTooltip = memo(function HoverTooltip({ hoveredData, worldPosition }) {
    if (!hoveredData || !worldPosition) return null;

    const { machine, status, taskCount } = hoveredData;
    const statusLabel = (status || 'idle').replace('_', ' ');

    const statusColor = {
        completed: '#22c55e',
        in_progress: '#eab308',
        delayed: '#ef4444',
        idle: '#6b7280',
    }[status] || '#6b7280';

    return (
        <Html
            position={[worldPosition.x, 2.5, worldPosition.z]}
            center
            distanceFactor={12}
            style={{ pointerEvents: 'none' }}
        >
            <div className="glass-strong rounded-xl px-3.5 py-2.5 shadow-2xl whitespace-nowrap">
                <p className="text-xs font-bold text-text-primary">{machine.name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                    <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: statusColor }}
                    />
                    <span className="text-[10px] text-text-secondary capitalize">{statusLabel}</span>
                </div>
                {taskCount > 0 && (
                    <p className="text-[10px] text-text-muted mt-1">{taskCount} task{taskCount > 1 ? 's' : ''} assigned</p>
                )}
            </div>
        </Html>
    );
});

// ── Factory Floor Grid — Theme-aware ────────────────────────
const FloorGrid = memo(function FloorGrid() {
    const theme = useThemeStore((s) => s.theme);
    const isDark = theme === 'dark';
    const gridColor1 = isDark ? '#1e293b' : '#cbd5e1';
    const gridColor2 = isDark ? '#0f1623' : '#e2e8f0';
    const floorColor = isDark ? '#0c1018' : '#f0f2f5';

    return (
        <group>
            <gridHelper args={[48, 48, gridColor1, gridColor2]} position={[0, -0.6, 0]} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.61, 0]} receiveShadow>
                <planeGeometry args={[48, 48]} />
                <meshStandardMaterial color={floorColor} roughness={0.95} metalness={0.05} />
            </mesh>
        </group>
    );
});

// ─────────────────────────────────────────────────────────────
// PART 4: Smart Camera Mode Toggle (HUD)
// ─────────────────────────────────────────────────────────────
function CameraHUD() {
    const mode = useAppStore(s => s.cameraMode);
    const setMode = useAppStore(s => s.setCameraMode);

    return (
        <div className="absolute top-3 right-3 flex gap-1 glass-strong p-1 rounded-xl z-10 shadow-lg pointer-events-auto">
            {['overview', 'focus', 'alert'].map(m => (
                <button
                    key={m}
                    onClick={() => { playClickSound(); setMode(m); }}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg transition-all cursor-pointer ${mode === m
                        ? m === 'alert' ? 'bg-danger/20 text-danger border border-danger/50 glow-danger'
                            : 'bg-accent/20 text-accent border border-accent/50 glow-accent'
                        : 'text-text-muted hover:text-text-primary hover:bg-bg-hover border border-transparent'
                        }`}
                >
                    {m}
                </button>
            ))}
        </div>
    );
}

// ── Scene Content ───────────────────────────────────────────
function SceneContent() {
    const machines = useAppStore((s) => s.machines);
    const tasks = useAppStore((s) => s.tasks);
    const selectedMachine = useAppStore((s) => s.selectedMachine);
    const setSelectedMachine = useAppStore((s) => s.setSelectedMachine);
    const getMachineStatus = useAppStore((s) => s.getMachineStatus);
    const getMachineDelayRisk = useAppStore((s) => s.getMachineDelayRisk);
    const cameraMode = useAppStore((s) => s.cameraMode);

    // ── Tooltip state (debounced) ──────────────────────────
    const [hoverInfo, setHoverInfo] = useState(null);
    const [hoverPos, setHoverPos] = useState(null);
    const hoverTimeout = useRef(null);

    // ── PART 5: Derive machine data with memoization ──────
    const machineData = useMemo(() => {
        return machines.map((m) => {
            const status = getMachineStatus(m.id);
            const risk = getMachineDelayRisk(m.id);
            const taskCount = tasks.filter((t) => t.machine_id === m.id).length;
            return {
                id: m.id,
                machine: m,
                position: [
                    (m.grid_x - GRID_OFFSET) * GRID_SPACING,
                    0,
                    (m.grid_y - GRID_OFFSET) * GRID_SPACING,
                ],
                status,
                risk,
                taskCount,
            };
        });
    }, [machines, tasks, getMachineStatus, getMachineDelayRisk]);

    // ── Camera target position ─────────────────────────────
    const cameraTarget = useMemo(() => {
        if (cameraMode === 'focus' && selectedMachine) {
            return [
                (selectedMachine.grid_x - GRID_OFFSET) * GRID_SPACING,
                0,
                (selectedMachine.grid_y - GRID_OFFSET) * GRID_SPACING,
            ];
        } else if (cameraMode === 'alert') {
            const delayedMachine = machineData.find(m => m.status === 'delayed') ||
                machineData.slice().sort((a, b) => b.risk - a.risk)[0];
            if (delayedMachine && (delayedMachine.status === 'delayed' || delayedMachine.risk > 0.5)) {
                return [
                    delayedMachine.position[0],
                    0,
                    delayedMachine.position[2],
                ];
            }
        }
        return null;
    }, [cameraMode, selectedMachine, machineData]);

    // ── Handlers ───────────────────────────────────────────
    const handleSelect = useCallback((data) => {
        playClickSound();
        setSelectedMachine(data.machine);
    }, [setSelectedMachine]);

    const handleHover = useCallback((data, point) => {
        // Debounce tooltip by 50ms to avoid flicker
        clearTimeout(hoverTimeout.current);
        if (data) {
            hoverTimeout.current = setTimeout(() => {
                setHoverInfo(data);
                setHoverPos(point);
            }, 50);
        } else {
            setHoverInfo(null);
            setHoverPos(null);
        }
    }, []);

    const activeMachines = useMemo(() => {
        return machineData.filter(m => m.status === 'in_progress' || m.status === 'delayed');
    }, [machineData]);

    return (
        <>
            <FloorGrid />
            <CameraController targetPosition={cameraTarget} />
            <FlowLines activeMachines={activeMachines} />

            <InstancedMachines
                machineData={machineData}
                onSelect={handleSelect}
                onHover={handleHover}
                selectedId={selectedMachine?.id}
            />

            <PredictiveIndicators machineData={machineData} />

            <HoverTooltip hoveredData={hoverInfo} worldPosition={hoverPos} />
        </>
    );
}

// ── PART 7: Loading + Empty Skeleton ────────────────────────
function SceneSkeleton() {
    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
                <div className="w-12 h-12 border-2 border-accent/30 border-t-accent rounded-full animate-spin-glow mx-auto mb-4" />
                <p className="text-xs text-text-muted font-mono tracking-wider">INITIALIZING 3D ENGINE</p>
                <p className="text-[10px] text-text-muted/60 mt-1">Loading factory floor...</p>
            </div>
        </div>
    );
}

function EmptyState() {
    const [dismissed, setDismissed] = useState(false);
    
    // Auto-hide when modals are open so it doesn't overlap
    const isAddMachineModalOpen = useAppStore((state) => state.isAddMachineModalOpen);
    const isCreateTaskModalOpen = useAppStore((state) => state.isCreateTaskModalOpen);
    const isAddUserModalOpen = useAppStore((state) => state.isAddUserModalOpen);
    
    const openAddMachineModal = useAppStore((state) => state.openAddMachineModal);
    const userRole = useAuthStore((state) => state.user?.role);
    const canCreateMachine = userRole === 'owner' || userRole === 'supervisor';

    if (dismissed || isAddMachineModalOpen || isCreateTaskModalOpen || isAddUserModalOpen) {
        return null;
    }

    return (
        <Html center zIndexRange={[10, 0]}>
            <div className="glass-strong rounded-2xl px-6 py-5 text-center shadow-2xl relative min-w-[250px]">
                {/* Close Button */}
                <button
                    onClick={() => setDismissed(true)}
                    className="absolute top-3 right-3 text-text-muted hover:text-text-primary transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mx-auto mb-3 border border-accent/20">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                </div>
                <p className="text-sm font-bold text-text-primary">No Machines</p>
                <p className="text-xs text-text-muted mt-1">Add a machine to populate the factory floor</p>
                {canCreateMachine ? (
                    <button
                        type="button"
                        onClick={openAddMachineModal}
                        className="mt-4 btn-primary rounded-xl px-4 py-2.5 text-xs font-semibold w-full"
                    >
                        + Add Machine
                    </button>
                ) : null}
            </div>
        </Html>
    );
}

// ── PART 8: Mobile Fallback ─────────────────────────────────
const MobileFallback = memo(function MobileFallback() {
    const machines = useAppStore((s) => s.machines);
    const tasks = useAppStore((s) => s.tasks);
    const getMachineStatus = useAppStore((s) => s.getMachineStatus);
    const setSelectedMachine = useAppStore((s) => s.setSelectedMachine);
    const openAddMachineModal = useAppStore((s) => s.openAddMachineModal);
    const userRole = useAuthStore((s) => s.user?.role);
    const canCreateMachine = userRole === 'owner' || userRole === 'supervisor';

    const statusDot = {
        completed: 'bg-success',
        in_progress: 'bg-warning',
        delayed: 'bg-danger animate-pulse',
        idle: 'bg-idle',
    };

    return (
        <div className="flex-1 overflow-y-auto p-4">
            <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-3">
                Factory Floor · {machines.length} machines
            </p>
            <div className="grid grid-cols-2 gap-2">
                {machines.map((m) => {
                    const status = getMachineStatus(m.id);
                    const taskCount = tasks.filter((t) => t.machine_id === m.id).length;
                    return (
                        <button
                            key={m.id}
                            onClick={() => setSelectedMachine(m)}
                            className="glass-card rounded-xl p-3 text-left cursor-pointer"
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <div className={`w-2.5 h-2.5 rounded-full ${statusDot[status]}`} />
                                <span className="text-xs font-medium text-text-primary truncate">{m.name}</span>
                            </div>
                            <p className="text-[10px] text-text-muted">
                                {m.machine_type || 'General'} · {taskCount} tasks
                            </p>
                        </button>
                    );
                })}
            </div>
            {machines.length === 0 && (
                <div className="text-center py-12">
                    <p className="text-sm text-text-muted">No machines available</p>
                    {canCreateMachine ? (
                        <button
                            type="button"
                            onClick={openAddMachineModal}
                            className="mt-4 btn-primary rounded-xl px-4 py-3 text-xs font-semibold"
                        >
                            + Add Machine to start factory
                        </button>
                    ) : null}
                </div>
            )}
        </div>
    );
});

// ─────────────────────────────────────────────────────────────
// Main Factory Scene — responsive wrapper
// ─────────────────────────────────────────────────────────────
// ── Theme-aware scene wrapper for clear color + fog ─────────
function ThemeAwareScene({ children }) {
    const theme = useThemeStore((s) => s.theme);
    const { gl, scene } = useThree();

    useEffect(() => {
        const isDark = theme === 'dark';
        const bgColor = isDark ? '#06080f' : '#f0f2f5';
        gl.setClearColor(bgColor);
        if (scene.fog) {
            scene.fog.color.set(bgColor);
        }
    }, [theme, gl, scene]);

    return children;
}

const FactoryScene = memo(function FactoryScene() {
    const machines = useAppStore((s) => s.machines);
    const loadingMachines = useAppStore((s) => s.loadingMachines);
    const theme = useThemeStore((s) => s.theme);
    const isDark = theme === 'dark';
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    if (isMobile) {
        return <MobileFallback />;
    }

    if (loadingMachines && machines.length === 0) {
        return <SceneSkeleton />;
    }

    const bgColor = isDark ? '#06080f' : '#f0f2f5';

    return (
        <div className="flex-1 relative">
            <Canvas
                shadows
                camera={{ position: [15, 12, 15], fov: 50, near: 0.1, far: 120 }}
                gl={{
                    antialias: false,
                    alpha: false,
                    powerPreference: 'high-performance',
                }}
                dpr={[1, 1.5]}
                onCreated={({ gl }) => {
                    gl.setClearColor(bgColor);
                    gl.toneMapping = THREE.ACESFilmicToneMapping;
                    gl.toneMappingExposure = isDark ? 0.9 : 1.1;
                    gl.shadowMap.type = THREE.PCFShadowMap;
                }}
            >
                <ThemeAwareScene>
                    <ambientLight intensity={isDark ? 0.2 : 0.35} />
                    <directionalLight
                        position={[12, 18, 10]}
                        intensity={isDark ? 0.7 : 0.9}
                        castShadow
                        shadow-mapSize={[1024, 1024]}
                        shadow-camera-near={0.5}
                        shadow-camera-far={50}
                        shadow-camera-left={-25}
                        shadow-camera-right={25}
                        shadow-camera-top={25}
                        shadow-camera-bottom={-25}
                        shadow-bias={-0.0001}
                    />
                    <pointLight position={[-12, 6, -12]} intensity={isDark ? 0.4 : 0.2} color="#818cf8" distance={30} decay={2} />
                    {isDark && <pointLight position={[12, 4, -8]} intensity={0.15} color="#fbbf24" distance={20} decay={2} />}

                    <fog attach="fog" args={[bgColor, isDark ? 25 : 20, isDark ? 60 : 55]} />

                    <Suspense fallback={null}>
                        <SceneContent />
                        {machines.length === 0 && !loadingMachines && <EmptyState />}
                    </Suspense>
                </ThemeAwareScene>
            </Canvas>

            {/* HUD overlay — controls hint */}
            <div className="absolute bottom-3 left-3 glass-strong rounded-lg px-3 py-1.5 text-[10px] text-text-muted/60 font-mono pointer-events-none select-none">
                FACTORY FLOOR · ORBIT: DRAG · ZOOM: SCROLL · SELECT: CLICK
            </div>

            {/* Machine count overlay */}
            {machines.length > 0 && (
                <div className="absolute top-3 left-3 glass-strong rounded-lg px-3 py-1.5 text-[10px] text-text-muted/50 font-mono pointer-events-none select-none">
                    {machines.length} MACHINE{machines.length !== 1 ? 'S' : ''} · INSTANCED RENDER
                </div>
            )}

            {!isMobile && <CameraHUD />}
        </div>
    );
});

export default FactoryScene;
