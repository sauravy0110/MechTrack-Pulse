const SIZE_MAP = {
    xs: 28,
    sm: 36,
    md: 44,
    lg: 56,
    xl: 72,
};

function resolveSize(size) {
    if (typeof size === 'number') return size;
    return SIZE_MAP[size] || SIZE_MAP.md;
}

export function BrandIcon({ size = 'md', className = '', animate = true }) {
    const pixelSize = resolveSize(size);
    const primary = '#103f52';
    const secondary = '#2f88a4';
    const teeth = Array.from({ length: 12 }, (_, index) => index * 30);

    return (
        <svg
            viewBox="0 0 128 128"
            width={pixelSize}
            height={pixelSize}
            role="img"
            aria-label="MechTrackPulse logo"
            className={`${animate ? 'brand-logo-rotate' : ''} ${className}`}
            style={{ willChange: animate ? 'transform' : undefined }}
        >
            <title>MechTrackPulse</title>
            <defs>
                {/* Subtle glow filter for the gear */}
                <filter id="gear-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>
            <g fill={primary} filter="url(#gear-glow)">
                {teeth.map((angle) => (
                    <rect
                        key={angle}
                        x="58"
                        y="4"
                        width="12"
                        height="18"
                        rx="4"
                        transform={`rotate(${angle} 64 64)`}
                    />
                ))}
            </g>

            <circle cx="64" cy="64" r="42" fill="none" stroke={primary} strokeWidth="12" />

            <g fill={secondary}>
                <rect x="34" y="62" width="12" height="26" rx="2.5" />
                <rect x="50" y="46" width="12" height="42" rx="2.5" />
                <rect x="66" y="30" width="12" height="58" rx="2.5" />
            </g>

            <path
                d="M18 86H46L54 72L62 101L74 52L84 97L94 84H112"
                fill="none"
                stroke={primary}
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export function BrandTitle({ title = 'MechTrackPulse', className = '' }) {
    return (
        <span className={`brand-shiny-text font-display leading-none text-text-primary ${className}`}>
            {title}
        </span>
    );
}

export default function BrandLogo({
    size = 'md',
    title = 'MechTrackPulse',
    subtitle = '',
    className = '',
    titleClassName = '',
    subtitleClassName = '',
    iconClassName = '',
    stacked = false,
    animate = true,
}) {
    const pixelSize = resolveSize(size);
    const directionClass = stacked ? 'flex-col items-start' : 'items-center';

    return (
        <div className={`inline-flex ${directionClass} gap-3 max-w-full ${className}`}>
            <BrandIcon size={pixelSize} className={`shrink-0 ${iconClassName}`} animate={animate} />
            <div className="min-w-0 max-w-full overflow-hidden">
                <BrandTitle title={title} className={titleClassName} />
                {subtitle ? (
                    <p className={`mt-1 text-[10px] sm:text-[11px] uppercase tracking-[0.14em] sm:tracking-[0.18em] text-text-muted break-words leading-tight ${subtitleClassName}`}>
                        {subtitle}
                    </p>
                ) : null}
            </div>
        </div>
    );
}

