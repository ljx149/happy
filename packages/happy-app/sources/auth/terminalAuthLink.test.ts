import { expect, it } from 'vitest';
import { terminalAuthKey } from './terminalAuthLink';
it('accepts CLI web and legacy links without crossing servers', () => {
    const key = 'A'.repeat(43), server = 'https://agent.xcodex.vip';
    expect(terminalAuthKey(`${server}/terminal/connect#key=${key}`, server)).toBe(key);
    expect(terminalAuthKey(`happy://terminal?${key}`, server)).toBe(key);
    expect(terminalAuthKey(`https://other.test/terminal/connect#key=${key}`, server)).toBeNull();
    expect(terminalAuthKey(`${server}/terminal/connect#key=bad`, server)).toBeNull();
});
