import { describe, expect, it } from 'vitest';
import { hasRequiredDshModel, isDshRuntime } from './dshEligibility';
describe('DSH configuration eligibility', () => {
  it.each(['xmodels/Xcoder1.0', '["xmodels","Xcoder1.0"]', '[ "xmodels", "Xcoder1.0" ]'])('accepts exact provider/model identity %s', code => {
    expect(hasRequiredDshModel([{ code }])).toBe(true);
  });
  it.each(['Xcoder1.0', 'other/Xcoder1.0', 'xmodels/Xcoder1.0-fake', '["xmodels","Xcoder1.0","extra"]', '{"provider":"xmodels"}', 'default'])('rejects aliases or incomplete identities %s', code => {
    expect(hasRequiredDshModel([{ code, value: 'xmodels/Xcoder1.0' } as any])).toBe(false);
  });
  it('requires an advertised model, not a fabricated default', () => expect(hasRequiredDshModel([])).toBe(false));
});

it.each(['dsh', '/opt/bin/dsh', 'C:\\tools\\dsh.cmd'])('recognizes direct DSH command %s', command => expect(isDshRuntime('custom', command)).toBe(true));
