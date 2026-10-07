import { Place } from '@/src/types';

const MAX_OSM_PLACES = 40;
const OVERPASS_TIMEOUT_SECONDS = 10;

type OsmElement = {
    id: number;
    type: 'node' | 'way' | 'relation';
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string>;
};

type OverpassResponse = {
    elements?: OsmElement[];
};

export const fetchNearbyPlaces = async (south: number, west: number, north: number, east: number, signal?: AbortSignal): Promise<OsmElement[]> => {
    // Bounding box format para Overpass: (south, west, north, east)
    const query = `
        [out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];
        (
            node["leisure"~"park|pitch|garden|fitness_station"](${south},${west},${north},${east});
            way["leisure"~"park|pitch|garden|fitness_station"](${south},${west},${north},${east});
            
            node["amenity"~"library|arts_centre|community_centre|bar|cafe"](${south},${west},${north},${east});
            way["amenity"~"library|arts_centre|community_centre|bar|cafe"](${south},${west},${north},${east});
        );
        out center ${MAX_OSM_PLACES};
    `;
    
    const url = 'https://overpass-api.de/api/interpreter';
    const body = `data=${encodeURIComponent(query)}`;
    
    const maxAttempts = 2;
    let delay = 750;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let retryable = true;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': 'ReunionHubApp/1.0'
                },
                body,
                signal
            });
            
            if (response.ok) {
                const data = await response.json() as OverpassResponse;
                if (!Array.isArray(data.elements)) throw new Error('Resposta inválida do OpenStreetMap.');
                return data.elements.slice(0, MAX_OSM_PLACES);
            }
            if (response.status !== 429 && response.status < 500) {
                retryable = false;
                throw new Error(`OpenStreetMap HTTP ${response.status}`);
            }
            if (attempt === maxAttempts) throw new Error(`OpenStreetMap HTTP ${response.status}`);
        } catch (error: unknown) {
            if (signal?.aborted) return [];
            if (!retryable || attempt === maxAttempts) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
    }
    throw new Error('Falha ao consultar o OpenStreetMap.');
};

export const mapOsmToPlace = (element: OsmElement): Place | null => {
    const tags = element.tags || {};
    if (!tags.name || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id)) return null;

    const vocations = [];
    
    // Mapeamento semântico
    if (tags.leisure === 'park' || tags.leisure === 'garden') vocations.push('natureza');
    if (tags.leisure === 'pitch') vocations.push('esporte');
    if (tags.leisure === 'fitness_station') vocations.push('exercício');
    if (tags.amenity === 'library' || tags.amenity === 'arts_centre' || tags.amenity === 'community_centre') vocations.push('cultura');
    if (tags.amenity === 'bar' || tags.amenity === 'cafe') vocations.push('social');
    
    const lat = Number(element.lat ?? element.center?.lat);
    const lon = Number(element.lon ?? element.center?.lon);

    if (!lat || !lon || isNaN(lat) || isNaN(lon)) return null;

    return {
        id: `osm_${element.type}_${element.id}`,
        name: tags.name,
        latitude: lat,
        longitude: lon,
        vocations: Array.from(new Set(vocations)),
        frequenters: []
    };
};
