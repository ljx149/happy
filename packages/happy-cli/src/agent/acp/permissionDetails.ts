/** ACP permission requests may contain only a reference to an earlier tool call. */
export class PermissionDetails {
  private calls = new Map<string, Record<string, unknown>>();

  remember(update: Record<string, unknown>) {
    if (!['tool_call', 'tool_call_update'].includes(String(update.sessionUpdate))) return;
    const id = update.toolCallId;
    if (typeof id !== 'string') return;
    const fields = Object.fromEntries(Object.entries(update).filter(([, value]) => value != null));
    this.calls.set(id, { ...this.calls.get(id), ...fields });
    if (this.calls.size > 1000) this.calls.delete(this.calls.keys().next().value!);
  }

  resolve(request: Record<string, unknown>, fallbackId: string) {
    const call = request.toolCall && typeof request.toolCall === 'object'
      ? request.toolCall as Record<string, unknown> : request;
    const id = typeof call.toolCallId === 'string' ? call.toolCallId : typeof call.id === 'string' ? call.id : fallbackId;
    const details = { ...this.calls.get(id), ...Object.fromEntries(Object.entries(call).filter(([, value]) => value != null)) };
    const name = [details.toolName, details.title, details.kind, request.kind].find(value => typeof value === 'string' && value.trim());
    const raw = details.rawInput ?? details.input ?? details.arguments ?? details.content ?? {};
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : { value: raw };
    return { id, toolName: typeof name === 'string' ? name : 'Unknown tool', input };
  }
}

/** Use ACP option kinds; display names may be localized or list rejection first. */
export function permissionOption(options: Array<{ optionId?: string; kind?: string }>, approved: boolean, forSession = false) {
  const kinds = approved ? (forSession ? ['allow_always', 'allow_once'] : ['allow_once']) : ['reject_once', 'reject_always'];
  for (const kind of kinds) {
    const option = options.find(option => option.kind === kind && option.optionId);
    if (option) return option.optionId;
  }
  const legacyId = approved ? (forSession ? 'proceed_always' : 'proceed_once') : 'cancel';
  return options.find(option => option.optionId === legacyId)?.optionId;
}
