import React from 'react';
import NyxDropdown from '../Common/NyxDropdown';
import type { NyxDropdownOption } from '../Common/NyxDropdown';

interface SourceVersion {
    id: number;
    name: string;
}

interface SourceSelectorProps {
    versions: SourceVersion[];
    selectedId: number;
    onSelect: (version: SourceVersion) => void;
    /** Classe CSS additionnelle */
    className?: string;
}

/**
 * Composant wrapper sur NyxDropdown pour la sélection de source IPTV.
 * Partagé entre SeriesDetailPage et MovieDetailPage.
 * Aucune logique SQLite — le parent passe les callbacks.
 */
const SourceSelector: React.FC<SourceSelectorProps> = ({
    versions,
    selectedId,
    onSelect,
    className,
}) => {
    if (versions.length < 2) return null;

    const options: NyxDropdownOption[] = versions.map((v) => ({
        value: String(v.id),
        label: v.name,
    }));

    const handleChange = (value: string) => {
        const version = versions.find((v) => v.id === Number(value));
        if (version) onSelect(version);
    };

    return (
        <NyxDropdown
            value={String(selectedId)}
            onChange={handleChange}
            options={options}
            className={['source-selector', className].filter(Boolean).join(' ')}
            id="source-selector"
            testId="source-selector"
        />
    );
};

export default SourceSelector;
