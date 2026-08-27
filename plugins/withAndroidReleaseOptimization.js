const {
  withAndroidStyles,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RELEASE_PROPERTIES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
  // Evita a otimizacao agressiva que corrompe Records Kotlin do expo-location.
  'android.r8.optimizedResourceShrinking': 'false',
};

const LOCATION_PROGUARD_RULES = `
# Reunion Hub: expo-location registra funcoes nativas que precisam permanecer
# acessiveis no APK otimizado. O restante do aplicativo continua usando R8.
-keep class expo.modules.location.** { *; }
`;

const NOTIFICATIONS_PROGUARD_RULES = `
# Reunion Hub: expo-notifications usa metodos privados writeObject/readObject
# chamados pela serializacao Java para persistir notificacoes agendadas.
-keep class expo.modules.notifications.** { *; }
`;

function upsertGradleProperty(properties, key, value) {
  const existing = properties.find(
    (item) => item.type === 'property' && item.key === key
  );
  if (existing) {
    existing.value = value;
    return;
  }
  properties.push({ type: 'property', key, value });
}

function applySafeProguardFile(buildGradle) {
  if (!buildGradle.includes('proguard-android-optimize.txt')) return buildGradle;

  const defaultProguardPattern = /getDefaultProguardFile\((['"])proguard-android-optimize\.txt\1\)/;
  if (!defaultProguardPattern.test(buildGradle)) {
    throw new Error('Não foi possível localizar o arquivo ProGuard padrão do build release.');
  }
  return buildGradle.replace(
    defaultProguardPattern,
    'getDefaultProguardFile("proguard-android.txt")'
  );
}

function removeDeprecatedStatusBarColor(styles) {
  const appTheme = styles.resources.style?.find(
    (style) => style.$?.name === 'AppTheme'
  );
  if (!appTheme?.item) return styles;

  appTheme.item = appTheme.item.filter(
    (item) => item.$?.name !== 'android:statusBarColor'
  );
  return styles;
}

function ensureLocationProguardRules(contents) {
  let nextContents = contents;
  if (!nextContents.includes('-keep class expo.modules.location.**')) {
    nextContents = `${nextContents.trimEnd()}\n${LOCATION_PROGUARD_RULES}`;
  }
  if (!nextContents.includes('-keep class expo.modules.notifications.**')) {
    nextContents = `${nextContents.trimEnd()}\n${NOTIFICATIONS_PROGUARD_RULES}`;
  }
  return nextContents;
}

module.exports = function withAndroidReleaseOptimization(config) {
  config = withGradleProperties(config, (gradleConfig) => {
    for (const [key, value] of Object.entries(RELEASE_PROPERTIES)) {
      upsertGradleProperty(gradleConfig.modResults, key, value);
    }
    return gradleConfig;
  });

  config = withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('A otimização release suporta somente build.gradle em Groovy.');
    }
    gradleConfig.modResults.contents = applySafeProguardFile(
      gradleConfig.modResults.contents
    );
    return gradleConfig;
  });

  config = withDangerousMod(config, ['android', async (androidConfig) => {
    const proguardFile = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app',
      'proguard-rules.pro'
    );
    const currentContents = fs.existsSync(proguardFile)
      ? fs.readFileSync(proguardFile, 'utf8')
      : '';
    const nextContents = ensureLocationProguardRules(currentContents);
    if (nextContents !== currentContents) {
      fs.writeFileSync(proguardFile, nextContents, 'utf8');
    }
    return androidConfig;
  }]);

  return withAndroidStyles(config, (stylesConfig) => {
    stylesConfig.modResults = removeDeprecatedStatusBarColor(stylesConfig.modResults);
    return stylesConfig;
  });
};

module.exports.applySafeProguardFile = applySafeProguardFile;
module.exports.ensureLocationProguardRules = ensureLocationProguardRules;
module.exports.removeDeprecatedStatusBarColor = removeDeprecatedStatusBarColor;
