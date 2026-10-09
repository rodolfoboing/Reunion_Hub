import { useEffect, useState } from 'react';
import { fetchNearbyTicketmasterEvents, isTicketmasterConfigured, type ExternalEvent } from '@/src/services/ticketmasterEventService';
import type { ExploreRegion } from './useExploreData';

export function useExternalEvents(enabled: boolean, region: ExploreRegion) {
    const [events, setEvents] = useState<ExternalEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);

    useEffect(() => {
        if (!enabled || !isTicketmasterConfigured) {
            setEvents([]);
            setLoading(false);
            setError(false);
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        setError(false);
        fetchNearbyTicketmasterEvents(region.latitude, region.longitude, controller.signal)
            .then((result) => {
                if (!controller.signal.aborted) setEvents(result);
            })
            .catch((failure: unknown) => {
                if (controller.signal.aborted) return;
                if (__DEV__) {
                    const code = failure instanceof Error && failure.message.startsWith('ticketmaster_')
                        ? failure.message : 'network_or_timeout';
                    console.warn('[ExternalEvents] search_failed', code);
                }
                setEvents([]);
                setError(true);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [enabled, retryKey, region.latitude, region.longitude]);

    return { events, loading, error, retry: () => setRetryKey((current) => current + 1) };
}
