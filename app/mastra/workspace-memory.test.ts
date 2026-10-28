import { describe, expect, it, vi } from 'vitest';

const { openMemoryStorage } = vi.hoisted(() => ({
    openMemoryStorage: vi.fn(),
}));
vi.mock('./memory-storage', () => ({ openMemoryStorage }));

const { getWorkspaceMemory, workspaceMemorySchema } =
    await import('./workspace-memory');

describe('getWorkspaceMemory', () => {
    it('is null while the memory database is unreachable', async () => {
        openMemoryStorage.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(getWorkspaceMemory()).resolves.toBeNull();
    });
});

describe('workspaceMemorySchema', () => {
    it('takes a partial update keyed by name', () => {
        expect(
            workspaceMemorySchema.parse({
                people: { 'Maya Chen': 'Owns the Atlas launch' },
                decisions: ['API freeze Nov 6 (Launch crew)'],
            }),
        ).toEqual({
            people: { 'Maya Chen': 'Owns the Atlas launch' },
            decisions: ['API freeze Nov 6 (Launch crew)'],
        });
    });
});
