export function normalizeDate(dateString: string | undefined | null): string | null {
    if (!dateString) return null;
    
    // Replace all slashes with dashes and remove whitespace
    const cleaned = dateString.trim().replace(/\//g, '-');
    const parts = cleaned.split('-');
    
    if (parts.length !== 3) return null;
    
    let yearText: string;
    let monthText: string;
    let dayText: string;

    // Check if it's already YYYY-MM-DD
    if (parts[0].length === 4) {
        [yearText, monthText, dayText] = parts;
    } 
    // Check if it's DD-MM-YYYY
    else if (parts[2].length === 4) {
        [dayText, monthText, yearText] = parts;
    } else {
        return null;
    }

    if (!/^\d{4}$/.test(yearText) || !/^\d{1,2}$/.test(monthText) || !/^\d{1,2}$/.test(dayText)) return null;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > daysInMonth) return null;

    return `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

function saoPauloParts(date: Date): Record<string, string> {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: SAO_PAULO_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]));
}

export function getTodayStr(now = new Date()): string {
    const parts = saoPauloParts(now);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getCurrentTimeStr(now = new Date()): string {
    const parts = saoPauloParts(now);
    return `${parts.hour}:${parts.minute}`;
}

export function getDateAfterDays(days: number, now = new Date()): string {
    const [year, month, day] = getTodayStr(now).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + Math.trunc(days)));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
