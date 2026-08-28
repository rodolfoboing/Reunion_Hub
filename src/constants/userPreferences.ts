export type NotificationSettingsPreferences = {
    notifyMessages: boolean;
    notifyEventUpdates: boolean;
    notifyEventReminders: boolean;
    notifyRecommendations: boolean;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettingsPreferences = {
    notifyMessages: true,
    notifyEventUpdates: true,
    notifyEventReminders: true,
    notifyRecommendations: true,
};
