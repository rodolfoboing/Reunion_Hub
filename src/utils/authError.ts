export function getFirebaseErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}

export function authLog(event: string, context: Record<string, string | number | boolean> = {}) {
    if (__DEV__) console.info(`[Auth] ${event}`, context);
}
