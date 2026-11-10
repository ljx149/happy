import { expect, it } from 'vitest';
import { normalize, format, isValid } from './backup';

it('preserves base64url identities containing hyphens across reload and recovery', () => {
    const secret = 'DHkSgXj73NTXNcGaenDCzxJ9sAw8fvon-FHb6Uy0XcM';
    expect(normalize(secret)).toBe(secret);
    expect(isValid(secret)).toBe(true);
    expect(normalize(format(secret))).toBe(secret);
});
