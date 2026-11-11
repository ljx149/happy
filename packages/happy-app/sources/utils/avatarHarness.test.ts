import { describe, expect, it } from 'vitest';
import { resolveAvatarHarness } from './avatarHarness';

describe('resolveAvatarHarness', () => {
    it('keeps the existing Claude, Codex, and Antigravity mappings', () => {
        expect(resolveAvatarHarness('claude')).toBe('claude');
        expect(resolveAvatarHarness('codex')).toBe('codex');
        expect(resolveAvatarHarness('agy')).toBe('agy');
    });

    it('uses Happy for the Rig client regardless of provider flavor', () => {
        expect(resolveAvatarHarness('codex', 'rig')).toBe('rig');
        expect(resolveAvatarHarness(null, 'rig')).toBe('rig');
    });

    it('recognizes DSH without confusing it with its model provider', () => {
        expect(resolveAvatarHarness('acp', null, 'dsh')).toBe('dsh');
        expect(resolveAvatarHarness('dsh')).toBe('dsh');
        expect(resolveAvatarHarness('acp')).toBeNull();
    });

    it('does not badge retired or unknown flavors', () => {
        expect(resolveAvatarHarness('gemini')).toBeNull();
        expect(resolveAvatarHarness('openclaw')).toBeNull();
        expect(resolveAvatarHarness('future-harness')).toBeNull();
        expect(resolveAvatarHarness(null)).toBeNull();
        expect(resolveAvatarHarness(undefined, 'other-client')).toBeNull();
    });
});