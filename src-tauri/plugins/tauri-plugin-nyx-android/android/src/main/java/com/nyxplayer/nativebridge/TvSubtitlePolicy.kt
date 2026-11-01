package com.nyxplayer.nativebridge

/**
 * Sous-titres sur TV, sans appel Android (testé sur la JVM, TvSubtitlePolicyTest).
 *
 * Beaucoup de téléviseurs agrandissent l'image reçue en HDMI et en rognent les bords, sans réglage
 * pour l'éviter (constaté sur une vraie télé). mpv pose les sous-titres texte à 22 / 720 ≈ 3 % du bas
 * de la vidéo : dans la bande rognée, ils sortaient presque de l'écran. Sur TV, ils sont remontés de
 * 5 % de plus (la marge de sécurité d'Android TV) : 58 / 720 ≈ 8 % de la hauteur.
 * L'interface, elle, reste plein écran : la réduction globale de la page (5 %) faisait couper
 * le contenu par la WebView et a été retirée ; la vidéo occupe tout l'écran.
 */
internal object TvSubtitlePolicy {
    /** Marge basse des sous-titres par défaut de mpv (`sub-margin-y`, sur une image de référence haute de 720) */
    const val DEFAULT_SUBTITLE_MARGIN_Y = 22

    /** Remontée sur TV : 5 % de la hauteur de référence (36 / 720) */
    private const val TV_EXTRA_MARGIN_Y = 36

    /**
     * Marge basse des sous-titres (`sub-margin-y` de mpv), ou null pour garder celle de mpv.
     * Concerne les sous-titres texte (SRT, WebVTT) ; les ASS stylés gardent leur propre marge et les
     * sous-titres image (DVB, PGS) suivent l'image vidéo. Téléphone : inchangé (null, aucun réglage envoyé à mpv).
     */
    fun subtitleMarginY(television: Boolean): Int? {
        if (!television) return null
        return DEFAULT_SUBTITLE_MARGIN_Y + TV_EXTRA_MARGIN_Y
    }
}
