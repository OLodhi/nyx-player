/**
 * Test: fetchCloudProviderHash
 * 
 * Verifies that the Supabase query correctly fetches the
 * stored provider hash from user_preferences cloud table.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase client — vi.hoisted ensures mocks exist before vi.mock is hoisted
const { mockMaybeSingle, mockEq2, mockEq1, mockSelect: _mockSelect, mockFrom } = vi.hoisted(() => {
    const mockMaybeSingle = vi.fn();
    const mockEq2 = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
    const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    return { mockMaybeSingle, mockEq2, mockEq1, mockSelect, mockFrom };
});

vi.mock('../../services/supabaseClient', () => ({
    supabase: {
        from: mockFrom,
        auth: { getSession: vi.fn() },
    },
}));

// Import AFTER mock
import { fetchCloudProviderHash } from '../../services/syncService';

describe('fetchCloudProviderHash', () => {
    const userId = 'user-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns hash when cloud has a stored value', async () => {
        mockMaybeSingle.mockResolvedValue({
            data: { value: 'abc123hash' },
            error: null,
        });

        const result = await fetchCloudProviderHash(userId);

        expect(result).toBe('abc123hash');
        expect(mockFrom).toHaveBeenCalledWith('user_preferences');
        expect(mockEq1).toHaveBeenCalledWith('user_id', userId);
        expect(mockEq2).toHaveBeenCalledWith('key', 'last_provider_hash');
    });

    it('returns null when no hash is stored', async () => {
        mockMaybeSingle.mockResolvedValue({
            data: null,
            error: null,
        });

        const result = await fetchCloudProviderHash(userId);

        expect(result).toBeNull();
    });

    it('returns null on Supabase error (graceful fallback)', async () => {
        mockMaybeSingle.mockResolvedValue({
            data: null,
            error: { message: 'Network error' },
        });

        const result = await fetchCloudProviderHash(userId);

        expect(result).toBeNull();
    });

    it('returns null on exception (offline)', async () => {
        mockMaybeSingle.mockRejectedValue(new Error('fetch failed'));

        const result = await fetchCloudProviderHash(userId);

        expect(result).toBeNull();
    });
});
