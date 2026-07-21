export function normalizeDate(dateString: string | undefined | null): string | null {
    if (!dateString) return null;
    
    // Replace all slashes with dashes and remove whitespace
    const cleaned = dateString.trim().replace(/\//g, '-');
    const parts = cleaned.split('-');
    
    if (parts.length !== 3) return null;
    
    // Check if it's already YYYY-MM-DD
    if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    } 
    // Check if it's DD-MM-YYYY
    else if (parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    
    return null;
}

export function getTodayStr(): string {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}
