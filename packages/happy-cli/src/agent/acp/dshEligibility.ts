export const DSH_SETUP_URL = 'https://xcodex.vip/connect?editor=deepseek';
export const DSH_SETUP_MESSAGE = '使用 DSH 前，需要在这台电脑的 DSH ACP 配置中添加 xmodels/Xcoder1.0。请按照教程完成配置，然后重新检测：' + DSH_SETUP_URL;

// ACP config values are opaque IDs. Current DSH encodes [provider, model];
// older ACP model catalogs used provider/model. Never trust display labels.
export function hasRequiredDshModel(models: readonly { code: string }[]): boolean {
  return models.some(({ code }) => {
    if (code === 'xmodels/Xcoder1.0') return true;
    try {
      const id: unknown = JSON.parse(code);
      return Array.isArray(id) && id.length === 2 && id[0] === 'xmodels' && id[1] === 'Xcoder1.0';
    } catch { return false; }
  });
}

export function isDshRuntime(agentName: string, command: string): boolean {
  return agentName === 'dsh' || /(?:^|[/\\])dsh(?:\.cmd|\.exe)?$/i.test(command);
}
