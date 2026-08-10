import { useEffect, useState } from 'react';

// Atualiza estados temporais sem depender de uma leitura extra do Firestore.
export function useEventClock(refreshIntervalMs = 60_000): Date {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const intervalId = setInterval(() => setNow(new Date()), refreshIntervalMs);
        return () => clearInterval(intervalId);
    }, [refreshIntervalMs]);

    return now;
}
