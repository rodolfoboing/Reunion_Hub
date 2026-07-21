export const fetchNearbyPlaces = async (south: number, west: number, north: number, east: number) => {
    // Bounding box format para Overpass: (south, west, north, east)
    const query = `
        [out:json][timeout:25];
        (
            node["leisure"~"park|pitch|garden|fitness_station"](${south},${west},${north},${east});
            way["leisure"~"park|pitch|garden|fitness_station"](${south},${west},${north},${east});
            
            node["amenity"~"library|arts_centre|community_centre|bar|cafe"](${south},${west},${north},${east});
            way["amenity"~"library|arts_centre|community_centre|bar|cafe"](${south},${west},${north},${east});
        );
        out center;
    `;
    
    const url = 'https://overpass-api.de/api/interpreter';
    const body = `data=${encodeURIComponent(query)}`;
    
    let retries = 3;
    let delay = 1000;

    while (retries > 0) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': 'ReunionHubApp/1.0'
                },
                body: body
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.elements || [];
            }
            
            if (response.status === 429 || response.status >= 500) {
                // Rate limit ou erro de servidor (504 Timeout) - tentar novamente
                retries--;
                if (retries > 0) {
                    await new Promise(res => setTimeout(res, delay));
                    delay *= 2; // Exponential backoff (1s -> 2s)
                    continue;
                }
            }
            
            // Outros erros ou falhou todas as tentativas
            console.warn(`[OSM Service] Falha na API (Status ${response.status}). Exibindo apenas locais do banco.`);
            return [];
            
        } catch (error: any) {
            retries--;
            if (retries > 0) {
                await new Promise(res => setTimeout(res, delay));
                delay *= 2;
                continue;
            }
            console.warn("[OSM Service] Timeout ou Erro de rede:", error.message);
            return [];
        }
    }
    return [];
};

export const mapOsmToPlace = (element: any) => {
    const tags = element.tags || {};
    if (!tags.name) return null;

    const vocations = [];
    
    // Mapeamento semântico
    if (tags.leisure === 'park' || tags.leisure === 'garden') vocations.push('natureza');
    if (tags.leisure === 'pitch') vocations.push('esporte');
    if (tags.leisure === 'fitness_station') vocations.push('exercício');
    if (tags.amenity === 'library' || tags.amenity === 'arts_centre' || tags.amenity === 'community_centre') vocations.push('cultura');
    if (tags.amenity === 'bar' || tags.amenity === 'cafe') vocations.push('social');
    
    const lat = Number(element.lat || element.center?.lat);
    const lon = Number(element.lon || element.center?.lon);

    if (!lat || !lon || isNaN(lat) || isNaN(lon)) return null;

    return {
        id: `osm_${element.id}`,
        name: tags.name,
        latitude: lat,
        longitude: lon,
        vocations: Array.from(new Set(vocations)),
        frequenters: []
    };
};
