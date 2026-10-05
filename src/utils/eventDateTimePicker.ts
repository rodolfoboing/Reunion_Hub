/**
 * Conversões entre os campos de texto do evento (`date` = `YYYY-MM-DD`,
 * `time` = `HH:MM`) e o `Date` que o `DateTimePicker` exige.
 *
 * Ficam aqui porque DUAS telas escrevem os mesmos campos — criar e editar
 * evento — e elas precisam interpretar o calendário de forma idêntica. Uma usar
 * o fuso do aparelho e a outra o de São Paulo produziria diferença de um dia
 * perto da meia-noite, no mesmo campo do mesmo documento.
 *
 * O fuso adotado é o do APARELHO, de propósito: é o calendário que a pessoa vê
 * no seletor. A conversão para o horário de São Paulo acontece depois, em
 * `getEventDateTime`, que é quem monta os instantes gravados em
 * `startsAt`/`endsAt` (§9).
 */

/** Texto `YYYY-MM-DD` → `Date` ao meio-dia, longe de qualquer virada de fuso. */
export function pickerDate(value: string): Date {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Texto `HH:MM` → `Date` de hoje nesse horário. Sem match, devolve agora. */
export function pickerTime(value: string): Date {
    const result = new Date();
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    result.setSeconds(0, 0);
    if (match) result.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return result;
}

export function formatPickerDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function formatPickerTime(value: Date): string {
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}
