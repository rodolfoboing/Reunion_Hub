export async function setupNotifications() {
  console.log('Notifications mocked for web.');
  return true;
}

export async function sendLocalNotification(title: string, body: string, seconds = 0) {
  console.log('Local notification requested on web:', title, body);
}
