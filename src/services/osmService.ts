export const fetchNearbyPlaces = async (south: number, west: number, north: number, east: number) => {
    // Bounding box format para Overpass: (south, west, north, east)
    const query = `
        [out:json][timeout:25];
        (
            node["leisure"~"park|pitch|garden|fitness_station"](${south},${west},${north},${east});
            way["leisure"~"park|pitch|garden|fitness_station"](${south},${west},${north},${east});
            node["sport"](${south},${west},${north},${east});
            way["sport"](${south},${west},${north},${east});
            node["amenity"~"library|arts_centre|community_centre"](${south},${west},${north},${east});
            way["amenity"~"library|arts_centre|community_centre"](${south},${west},${north},${east});
        );
        out center;
    `;
    
    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'User-Agent': 'ReunionHubApp/1.0'
            },
            body: `data=${encodeURIComponent(query)}`
        });
        
        if (!response.ok) {
            throw new Error(`Overpass API errored with status: ${response.status}`);
        }
        
        const data = await response.json();
        return data.elements || [];
    } catch (error) {
        console.error("OSM Error:", error);
        return [];
    }
};

export const mapOsmToPlace = (element: any) => {
    const tags = element.tags || {};
    // Ignorar locais sem nome para não poluir muito o mapa com "Local sem nome"
    if (!tags.name) return null;

    const vocations = [];
    
    if (tags.sport) {
        // Separar esportes se houver múltiplos separados por ponto e vírgula
        tags.sport.split(';').forEach((s: string) => vocations.push(s));
    }
    if (tags.leisure === 'park' || tags.leisure === 'garden') vocations.push('natureza');
    if (tags.leisure === 'pitch') vocations.push('esporte');
    if (tags.leisure === 'fitness_station') vocations.push('exercício');
    if (tags.amenity === 'library' || tags.amenity === 'arts_centre') vocations.push('cultura');
    
    const lat = element.lat || element.center?.lat;
    const lon = element.lon || element.center?.lon;

    if (!lat || !lon) return null;

    return {
        id: `osm_${element.id}`,
        name: tags.name,
        latitude: lat,
        longitude: lon,
        vocations: Array.from(new Set(vocations)),
        type: 'place', // Para distinguir de 'meeting' no frontend
        founderId: null,
        founderName: null,
        frequentersCount: 0
    };
};
