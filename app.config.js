const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  expo: {
    name: 'Reunion Hub',
    slug: 'reunion-hub',
    version: '1.0.2',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'reunionhub',
    userInterfaceStyle: 'automatic',
    splash: {
      image: './assets/images/icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    plugins: [
      './plugins/withAndroidReleaseSigning',
      './plugins/withAndroidReleaseOptimization',
      'expo-router',
      'expo-location',
      'expo-image-picker',
      '@react-native-community/datetimepicker',
      [
        'expo-notifications',
        {
          // Ícone monocromático com transparência, exigido pela bandeja do Android.
          icon: './assets/images/favicon.png',
          color: '#4F46E5',
          defaultChannel: 'events',
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/images/icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
        },
      ],
      'expo-font',
      'expo-web-browser',
    ],
    android: {
      package: 'com.rodolfoboing.reunionhub',
      versionCode: 3,
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'POST_NOTIFICATIONS',
        'SCHEDULE_EXACT_ALARM',
      ],
      config: googleMapsApiKey
        ? { googleMaps: { apiKey: googleMapsApiKey } }
        : undefined,
      // Configuração pública do cliente Firebase. Uma variável de arquivo do
      // EAS ainda pode substituí-la, mas clones locais funcionam sem etapa manual.
      googleServicesFile,
    },
    extra: {
      router: {},
      eas: {
        projectId: '127b8011-be6f-4e9f-96d3-0a383af872f4',
      },
    },
  },
};
