import { describe, expect, test } from 'vitest';
import { parseRoute } from './App';

describe('parseRoute', () => {
  test('session route extracts the id from #session/<id>', () => {
    const route = parseRoute('/', '#session/abc123');
    expect(route).toEqual({ page: 'session-detail', id: 'abc123' });
  });

  test('hash routes win over the /terminal/connect pathname', () => {
    expect(parseRoute('/terminal/connect', '#restore')).toEqual({ page: 'restore' });
    expect(parseRoute('/terminal/connect', '#home')).toEqual({ page: 'workbench' });
    expect(parseRoute('/terminal/connect', '#session/xyz')).toEqual({ page: 'session-detail', id: 'xyz' });
  });

  test('terminal connect only when the hash is a pairing key or empty', () => {
    expect(parseRoute('/terminal/connect', '#key=SGVsbG8')).toEqual({ page: 'terminal-connect', key: 'SGVsbG8' });
    expect(parseRoute('/terminal/connect', '')).toEqual({ page: 'terminal-connect', key: undefined });
  });

  test('unknown routes fall back to login', () => {
    expect(parseRoute('/', '')).toEqual({ page: 'login' });
    expect(parseRoute('/anything', '#unknown')).toEqual({ page: 'login' });
  });
});
