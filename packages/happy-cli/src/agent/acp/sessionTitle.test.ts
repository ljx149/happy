import { describe, expect, it } from 'vitest';
import { AcpSessionTitle, normalizeSessionTitle } from './sessionTitle';
const empty = { path: '/tmp', host: 'test', homeDir: '/tmp', happyHomeDir: '/tmp', happyLibDir: '/tmp', happyToolsDir: '/tmp' };
describe('DSH automatic titles', () => {
  it('creates a fallback once and upgrades it when the runtime reports a title', () => {
    const titles = new AcpSessionTitle();
    const first = titles.apply(empty, '  修复\n登录页面  ', true);
    expect(first.summary?.text).toBe('修复 登录页面');
    expect(titles.apply(first, 'second message', true)).toBe(first);
    const refined = titles.apply(first, '登录页修复');
    expect(refined.summary?.text).toBe('登录页修复');
    expect(titles.apply(refined, '登录页修复')).toBe(refined);
    // Metadata conflict retry can call the updater again with the older version.
    expect(titles.apply(first, '登录页修复').summary?.text).toBe('登录页修复');
  });
  it('preserves existing names and manual summary changes, including same-text renames', () => {
    const titles = new AcpSessionTitle();
    const first = titles.apply(empty, 'auto');
    for (const metadata of [
      { ...first, name: 'My title' },
      { ...first, summary: { text: 'Manual title', updatedAt: 1 } },
      { ...first, summary: { text: 'auto', updatedAt: 1 } },
    ]) expect(titles.apply(metadata, 'replacement')).toBe(metadata);
    expect(new AcpSessionTitle().apply(first, 'replacement')).toBe(first);
  });
  it('ignores absent titles and limits titles without splitting emoji', () => {
    for (const value of [null, undefined, {}, '', ' \n ']) expect(normalizeSessionTitle(value)).toBeNull();
    expect(Array.from(normalizeSessionTitle('🐳'.repeat(100))!)).toHaveLength(80);
  });
});
