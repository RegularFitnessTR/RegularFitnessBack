export interface GetMyNotificationsData {
    limit?: number;
    gymId?: string;
}

export interface MarkNotificationAsReadData {
    notificationId: string;
}
