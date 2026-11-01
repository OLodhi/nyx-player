import React, { useLayoutEffect, useRef } from 'react';
import { createRail, type Rail, type RailSource } from './rail';
import type { RailRowLayout } from './railRow';

interface RecycledRailProps {
    rows: readonly string[];
    source: RailSource;
    gap?: number;
    covered?: boolean;
    /** Présentation des rangées : catégories du fournisseur (par défaut) ou carrousels de Suggestions */
    layout?: RailRowLayout;
    /** Classes de la liste (la page de Suggestions y ajoute la sienne) */
    className?: string;
}

/**
 * Rangées de l'accueil TV (rail.ts) : React ne rend que la liste, le rail la remplit lui-même. `rows` : les catégories
 * dans l'ordre ; `source` : la rangée d'une catégorie (titre, cartes), relue quand elle change ; `covered` : accueil
 * caché par une fiche ou par le lecteur.
 */
const RecycledRail: React.FC<RecycledRailProps> = ({ rows, source, gap, covered = false, layout = 'category', className = 'iptv-mode rail' }) => {
    const listRef = useRef<HTMLDivElement>(null);
    const railRef = useRef<Rail | null>(null);

    useLayoutEffect(() => {
        const rail = createRail(listRef.current!, gap, layout);
        railRef.current = rail;
        return () => {
            rail.destroy();
            railRef.current = null;
        };
    }, [gap, layout]);

    // Rail recréé (`gap`, `layout`) : données et catégories reposées
    useLayoutEffect(() => {
        railRef.current?.setSource(source);
    }, [source, gap, layout]);
    useLayoutEffect(() => {
        railRef.current?.setRows(rows);
    }, [rows, gap, layout]);
    useLayoutEffect(() => {
        railRef.current?.setCovered(covered);
    }, [covered, gap, layout]);

    return <div ref={listRef} className={className} />;
};

export default RecycledRail;
