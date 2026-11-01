/**
 * GeekStatsOverlay - Overlay technique affichant les stats du player
 *
 * Organisé en 3 sections : Video / Audio / Réseau
 * Coloration conditionnelle : vert (bon), orange (warning), rouge (danger)
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import './GeekStatsOverlay.css';
import { StatsIcon } from './PlayerIcons';

// Re-export for backward compatibility
export type { GeekStats } from '../../types/player';
import type { GeekStats } from '../../types/player';


interface GeekStatsOverlayProps {
    stats: GeekStats;
    onClose: () => void;
}

// ── Formatters ──────────────────────────────────────────────

const formatBitrate = (bps: number): string => {
    if (!bps || bps <= 0) return 'N/A';
    const mbps = bps / 1_000_000;
    if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
    return `${(bps / 1000).toFixed(0)} Kbps`;
};

const formatBuffer = (seconds: number): string => {
    if (seconds <= 0) return '0s';
    return `${seconds.toFixed(1)}s`;
};

// ── Classifiers ─────────────────────────────────────────────

const getResolutionClass = (height: number): string => {
    if (height >= 1080) return 'stat-good';
    if (height >= 720) return 'stat-warning';
    if (height > 0) return 'stat-danger';
    return '';
};

const getBufferClass = (seconds: number): string => {
    if (seconds >= 3) return 'stat-good';
    if (seconds >= 1) return 'stat-warning';
    return 'stat-danger';
};

const getDroppedClass = (count: number): string => {
    if (count === 0) return 'stat-good';
    if (count <= 10) return 'stat-warning';
    return 'stat-danger';
};

const getHwdecClass = (hwdec: string): string => {
    if (hwdec && hwdec !== 'sw' && hwdec !== 'no') return 'stat-good';
    return 'stat-warning';
};

// ── Stat Row ────────────────────────────────────────────────

/** Libellés des lignes (clés de premier niveau de player.json) */
type StatLabel = 'resolution' | 'video_codec' | 'fps' | 'video_bitrate' | 'pixel_format' | 'hw_decode'
    | 'audio_codec' | 'audio_bitrate' | 'audio_channels' | 'dns_video' | 'buffer' | 'dropped_frames';

interface StatRowProps {
    label: StatLabel;
    value: string;
    className?: string;
}

const StatRow: React.FC<StatRowProps> = ({ label, value, className = '' }) => {
    const { t } = useTranslation('player');
    return (
        <div className="geek-stats-row">
            <span className="geek-stats-label">{t(label)}</span>
            <span className={`geek-stats-value ${className}`}>{value}</span>
        </div>
    );
};

// ── Main Component ──────────────────────────────────────────

const GeekStatsOverlay: React.FC<GeekStatsOverlayProps> = ({ stats, onClose }) => {
    const { t } = useTranslation('player');

    const resolution = stats.width > 0 && stats.height > 0
        ? `${stats.width}×${stats.height}`
        : 'N/A';

    const fps = stats.fps > 0 ? stats.fps.toFixed(0) : 'N/A';
    const dropped = stats.dropFrames >= 0 ? String(stats.dropFrames) : '0';
    const buffer = formatBuffer(stats.bufferSeconds);

    return (
        <div className="geek-stats-overlay">
            <div className="geek-stats-header">
                <span className="geek-stats-title"><StatsIcon /> {t('geek_stats')}</span>
                <button className="geek-stats-close" data-testid="player-stats-close" onClick={onClose} title={t('error_close')} aria-label={t('error_close')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                </button>
            </div>
            <div className="geek-stats-grid">
                {/* ── VIDEO ── */}
                <div className="geek-stats-section-title">{t('section_video')}</div>
                <StatRow label="resolution" value={resolution} className={getResolutionClass(stats.height)} />
                <StatRow label="video_codec" value={stats.videoCodec || 'N/A'} />
                <StatRow label="fps" value={fps} />
                <StatRow label="video_bitrate" value={formatBitrate(stats.videoBitrate)} />
                <StatRow label="pixel_format" value={stats.pixelFormat || 'N/A'} />
                <StatRow label="hw_decode" value={stats.hwdec} className={getHwdecClass(stats.hwdec)} />

                {/* ── AUDIO ── */}
                <div className="geek-stats-section-title">{t('section_audio')}</div>
                <StatRow label="audio_codec" value={stats.audioCodec || 'N/A'} />
                <StatRow label="audio_bitrate" value={formatBitrate(stats.audioBitrate)} />
                <StatRow label="audio_channels" value={stats.audioChannels} />

                {/* ── RÉSEAU ── */}
                <div className="geek-stats-section-title">{t('section_network')}</div>
                {/* La vidéo résout toujours par le DNS de l'appareil : le réglage « DNS sécurisé » ne vaut que pour le catalogue et le guide */}
                <StatRow label="dns_video" value={t('dns_video_system')} />
                <StatRow label="buffer" value={buffer} className={getBufferClass(stats.bufferSeconds)} />
                <StatRow label="dropped_frames" value={dropped} className={getDroppedClass(stats.dropFrames)} />
            </div>
        </div>
    );
};

export default GeekStatsOverlay;
