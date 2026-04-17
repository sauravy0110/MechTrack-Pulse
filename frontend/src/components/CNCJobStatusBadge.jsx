/**
 * CNCJobStatusBadge — Reusable badge for CNC-specific job statuses
 * Supports all 16 statuses across General and CNC pipelines.
 * Matches the existing premium-surface design system.
 */

const CNC_STATUS_CONFIG = {
    // General statuses
    idle:                 { label: 'Idle',              color: '#8B8FA8', bg: 'rgba(139,143,168,0.15)' },
    queued:               { label: 'Queued',            color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' },
    in_progress:          { label: 'In Progress',       color: '#60A5FA', bg: 'rgba(96,165,250,0.15)' },
    paused:               { label: 'Paused',            color: '#FBBF24', bg: 'rgba(251,191,36,0.15)'  },
    completed:            { label: 'Completed',         color: '#34D399', bg: 'rgba(52,211,153,0.15)' },
    delayed:              { label: 'Delayed',           color: '#F87171', bg: 'rgba(248,113,113,0.15)' },

    // CNC Pipeline statuses
    created:              { label: 'Created',           color: '#818CF8', bg: 'rgba(129,140,248,0.15)' },
    planned:              { label: 'Planned',           color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' },
    ready:                { label: 'Material Ready',    color: '#4ADE80', bg: 'rgba(74,222,128,0.12)'  },
    assigned:             { label: 'Assigned',          color: '#60A5FA', bg: 'rgba(96,165,250,0.15)' },
    setup:                { label: 'Setup Phase',       color: '#F59E0B', bg: 'rgba(245,158,11,0.15)'  },
    setup_done:           { label: 'Setup Done',        color: '#10B981', bg: 'rgba(16,185,129,0.15)'  },
    first_piece_approval: { label: 'First Piece QC',   color: '#06B6D4', bg: 'rgba(6,182,212,0.15)'   },
    qc_check:             { label: 'QC Check',          color: '#F97316', bg: 'rgba(249,115,22,0.15)'  },
    final_inspection:     { label: 'Final Inspection',  color: '#14B8A6', bg: 'rgba(20,184,166,0.15)'  },
    submitted_for_review: { label: 'Pending Review',    color: '#0EA5E9', bg: 'rgba(14,165,233,0.15)'  },
    dispatched:           { label: 'Dispatched',        color: '#22D3EE', bg: 'rgba(34,211,238,0.15)'  },
};

// Client-friendly labels
const CLIENT_LABELS = {
    created:              'Order Received',
    planned:              'In Planning',
    ready:                'Material Ready',
    assigned:             'In Queue',
    setup:                'Preparing',
    setup_done:           'Setup Complete',
    first_piece_approval: 'Quality Check',
    in_progress:          'In Production',
    qc_check:             'Quality Check',
    final_inspection:     'Final Review',
    submitted_for_review: 'Pending Review',
    dispatched:           'Shipped',
    completed:            'Delivered',
    idle:                 'Received',
    queued:               'In Queue',
    delayed:              'Delayed',
    paused:               'On Hold',
};

export default function CNCJobStatusBadge({ status, forClient = false, size = 'md', showDot = true }) {
    const config = CNC_STATUS_CONFIG[status] || { label: status, color: '#8B8FA8', bg: 'rgba(139,143,168,0.15)' };
    const label = forClient ? (CLIENT_LABELS[status] || config.label) : config.label;

    const sizeStyles = {
        sm: { fontSize: '10px', padding: '2px 8px', gap: '4px', dotSize: '6px' },
        md: { fontSize: '11px', padding: '3px 10px', gap: '5px', dotSize: '7px' },
        lg: { fontSize: '12px', padding: '4px 12px', gap: '6px', dotSize: '8px' },
    }[size] || sizeStyles.md;

    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: sizeStyles.gap,
            backgroundColor: config.bg,
            color: config.color,
            border: `1px solid ${config.color}33`,
            borderRadius: '20px',
            padding: sizeStyles.padding,
            fontSize: sizeStyles.fontSize,
            fontWeight: 600,
            fontFamily: 'Inter, sans-serif',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
        }}>
            {showDot && (
                <span style={{
                    width: sizeStyles.dotSize,
                    height: sizeStyles.dotSize,
                    borderRadius: '50%',
                    backgroundColor: config.color,
                    flexShrink: 0,
                    animation: ['in_progress', 'setup', 'qc_check'].includes(status)
                        ? 'pulse 2s ease-in-out infinite'
                        : 'none',
                }} />
            )}
            {label}
        </span>
    );
}

export { CNC_STATUS_CONFIG, CLIENT_LABELS };
