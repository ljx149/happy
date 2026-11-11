/** Initialization may register listeners before failing; retry only after reload.
 * Keep the rejection so subsequent login calls cannot falsely succeed. */
export function singleInitialization() {
    let pending: Promise<void> | undefined;
    return (initialize: () => Promise<void>): Promise<void> => {
        pending ??= Promise.resolve().then(initialize);
        return pending;
    };
}
