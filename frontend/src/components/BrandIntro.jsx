/**
 * BrandIntro — Premium brand entry animation for MechTrackPulse.
 *
 * Sequence (polished):
 *   1.  Logo splits in from top/bottom halves with overshoot bounce
 *   2.  Gear rim flash (one-shot light highlight)
 *   3.  Gear begins slow rotation (200ms after merge settles)
 *   4.  "MechTrackPulse" title reveals letter-by-letter (blur snap)
 *   5.  Shine sweep synced ~150ms after merge settle
 *   6.  Tagline fades in
 *   7.  Entire overlay fades out → app content crossfades in
 *
 * Trigger control:
 *   - Plays on first load, sign-in, and logout (via sessionStorage flag)
 *   - Does NOT replay on route changes within the same session
 */

import { useState, useEffect } from 'react';

// ── Session flag name ────────────────────────────────────────
const INTRO_PLAYED_KEY = 'mtp_intro_played';

// ── Timing constants (ms) ────────────────────────────────────
const T_LOGO_MERGE    = 700;   // CSS animation duration for overshoot merge
const T_GEAR_DELAY    = 200;   // delay before gear spin starts after merge
const T_FLASH_START   = T_LOGO_MERGE - 100; // gear flash starts just as merge settles
const T_TITLE_START   = T_LOGO_MERGE + 150; // synced 150ms after merge settles
const T_TITLE_LETTER  = 55;    // per-letter stagger
const T_TAGLINE_START = T_TITLE_START + 'MechTrackPulse'.length * T_TITLE_LETTER + 150;
const T_SHINE_START   = T_TAGLINE_START + 400;
const T_FADE_OUT      = T_SHINE_START + 800;
const T_DESTROY       = T_FADE_OUT + 700;

const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

const TITLE_TEXT = 'MechTrackPulse';
const TAGLINE_TEXT = 'Precision. Progress. Performance.';

// ── Gear SVG constants ───────────────────────────────────────
const GEAR_SIZE = 96;
const PRIMARY = '#103f52';
const SECONDARY = '#2f88a4';

// ── Shared gear internals (DRY) ──────────────────────────────
function GearInternals() {
    const teeth = Array.from({ length: 12 }, (_, i) => i * 30);
    return (
        <>
            <g fill={PRIMARY}>
                {teeth.map((angle) => (
                    <rect
                        key={angle}
                        x="58" y="4" width="12" height="18" rx="4"
                        transform={`rotate(${angle} 64 64)`}
                    />
                ))}
            </g>
            <circle cx="64" cy="64" r="42" fill="none" stroke={PRIMARY} strokeWidth="12" />
            <g fill={SECONDARY}>
                <rect x="34" y="62" width="12" height="26" rx="2.5" />
                <rect x="50" y="46" width="12" height="42" rx="2.5" />
                <rect x="66" y="30" width="12" height="58" rx="2.5" />
            </g>
            <path
                d="M18 86H46L54 72L62 101L74 52L84 97L94 84H112"
                fill="none"
                stroke={PRIMARY}
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </>
    );
}

// ── Tweak 2: Halves now use CSS keyframes with overshoot ─────
function GearHalf({ half, active }) {
    const clipId = `gear-clip-${half}`;
    const isTop = half === 'top';

    return (
        <div
            className={`intro-gear-half ${active ? (isTop ? 'intro-merge-top' : 'intro-merge-bottom') : ''}`}
            style={{
                position: 'absolute',
                inset: 0,
                opacity: active ? undefined : 0,
            }}
        >
            <svg
                viewBox="0 0 128 128"
                width={GEAR_SIZE}
                height={GEAR_SIZE}
                aria-hidden="true"
            >
                <defs>
                    <clipPath id={clipId}>
                        <rect
                            x="0"
                            y={isTop ? '0' : '64'}
                            width="128"
                            height="64"
                        />
                    </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`}>
                    <GearInternals />
                </g>
            </svg>
        </div>
    );
}

function FullGear({ spinning, showFlash }) {
    return (
        <div style={{ position: 'relative', width: GEAR_SIZE, height: GEAR_SIZE }}>
            <svg
                viewBox="0 0 128 128"
                width={GEAR_SIZE}
                height={GEAR_SIZE}
                aria-hidden="true"
                className={spinning ? 'intro-gear-spin' : ''}
                style={{
                    filter: 'drop-shadow(0 0 12px rgba(47, 136, 164, 0.25))',
                }}
            >
                <GearInternals />
            </svg>
            {/* Tweak 3: One-shot rim flash */}
            {showFlash && <div className="intro-gear-flash" />}
        </div>
    );
}

// ── Main component ───────────────────────────────────────────
export default function BrandIntro({ onComplete }) {
    const [phase, setPhase] = useState('hidden');
    // Phase: hidden → split → merged → flash → spinning → title → tagline → shine → fadeout → done

    useEffect(() => {
        const timers = [];
        const t = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); };

        // Phase 1: Trigger CSS overshoot merge
        t(() => setPhase('split'), 50);

        // Phase 2: Swap to full gear (after CSS merge completes)
        t(() => setPhase('merged'), T_LOGO_MERGE + 50);

        // Phase 3: Gear flash
        t(() => setPhase('flash'), T_FLASH_START);

        // Phase 4: Gear spin
        t(() => setPhase('spinning'), T_LOGO_MERGE + T_GEAR_DELAY);

        // Phase 5: Title (synced 150ms after merge settle)
        t(() => setPhase('title'), T_TITLE_START);

        // Phase 6: Tagline
        t(() => setPhase('tagline'), T_TAGLINE_START);

        // Phase 7: Shine
        t(() => setPhase('shine'), T_SHINE_START);

        // Phase 8: Fade out
        t(() => setPhase('fadeout'), T_FADE_OUT);

        // Phase 9: Done → destroy
        t(() => {
            setPhase('done');
            sessionStorage.setItem(INTRO_PLAYED_KEY, '1');
            onComplete?.();
        }, T_DESTROY);

        return () => timers.forEach(clearTimeout);
    }, [onComplete]);

    if (phase === 'done') return null;

    const splitActive = phase !== 'hidden';
    const merged = ['merged', 'flash', 'spinning', 'title', 'tagline', 'shine', 'fadeout'].includes(phase);
    const showFlash = ['flash', 'spinning', 'title', 'tagline', 'shine', 'fadeout'].includes(phase);
    const spinning = ['spinning', 'title', 'tagline', 'shine', 'fadeout'].includes(phase);
    const showTitle = ['title', 'tagline', 'shine', 'fadeout'].includes(phase);
    const showTagline = ['tagline', 'shine', 'fadeout'].includes(phase);
    const showShine = ['shine', 'fadeout'].includes(phase);
    const fadingOut = phase === 'fadeout';

    return (
        <div
            className="intro-overlay"
            style={{
                opacity: fadingOut ? 0 : 1,
                transition: `opacity 650ms ${EASING}`,
            }}
        >
            {/* Background particles (≤6 for perf) */}
            <div className="intro-particles" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div
                        key={i}
                        className="intro-particle"
                        style={{
                            left: `${15 + i * 14}%`,
                            animationDelay: `${i * 0.7}s`,
                            animationDuration: `${4 + i * 0.5}s`,
                        }}
                    />
                ))}
            </div>

            {/* Content container */}
            <div className="intro-content">
                {/* Logo */}
                <div
                    className="intro-logo-container"
                    style={{ width: GEAR_SIZE, height: GEAR_SIZE }}
                >
                    {!merged ? (
                        <>
                            <GearHalf half="top" active={splitActive} />
                            <GearHalf half="bottom" active={splitActive} />
                        </>
                    ) : (
                        <FullGear spinning={spinning} showFlash={showFlash} />
                    )}
                </div>

                {/* Title — letter by letter with blur snap */}
                <div
                    className="intro-title-row"
                    style={{
                        opacity: showTitle ? 1 : 0,
                        transform: showTitle ? 'translateY(0)' : 'translateY(12px)',
                        transition: `opacity 400ms ${EASING}, transform 400ms ${EASING}`,
                    }}
                >
                    {TITLE_TEXT.split('').map((char, i) => (
                        <span
                            key={i}
                            className={`intro-letter ${showShine ? 'intro-shine-letter' : ''}`}
                            style={{
                                animationDelay: showTitle ? `${i * T_TITLE_LETTER}ms` : '0ms',
                                opacity: showTitle ? undefined : 0,
                            }}
                        >
                            {char}
                        </span>
                    ))}
                </div>

                {/* Tagline */}
                <p
                    className="intro-tagline"
                    style={{
                        opacity: showTagline ? 0.7 : 0,
                        transform: showTagline ? 'translateY(0)' : 'translateY(8px)',
                        transition: `opacity 500ms ${EASING} 100ms, transform 500ms ${EASING} 100ms`,
                    }}
                >
                    {TAGLINE_TEXT}
                </p>

                {/* Decorative line */}
                <div
                    className="intro-line"
                    style={{
                        transform: showTagline ? 'scaleX(1)' : 'scaleX(0)',
                        transition: `transform 600ms ${EASING} 200ms`,
                    }}
                />
            </div>
        </div>
    );
}

// ── Hook: should the intro play? ─────────────────────────────
export function useShowBrandIntro() {
    return !sessionStorage.getItem(INTRO_PLAYED_KEY);
}

// ── Utility: force the intro on next navigation ──────────────
export function resetBrandIntro() {
    sessionStorage.removeItem(INTRO_PLAYED_KEY);
}
