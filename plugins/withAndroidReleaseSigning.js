const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_ENV_MARKER = "System.getenv('REUNION_UPLOAD_STORE_FILE')";

const signingEnvironmentBlock = `
// Credenciais de produção nunca devem ficar no repositório. Variáveis de
// ambiente têm prioridade; para builds locais, o credentials.json ignorado
// pelo Git é a alternativa oficial do EAS.
def releaseStoreFile = System.getenv('REUNION_UPLOAD_STORE_FILE')
def releaseStorePassword = System.getenv('REUNION_UPLOAD_STORE_PASSWORD')
def releaseKeyAlias = System.getenv('REUNION_UPLOAD_KEY_ALIAS')
def releaseKeyPassword = System.getenv('REUNION_UPLOAD_KEY_PASSWORD')
def hasCompleteReleaseCredentials = {
    [releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword]
        .every { value -> value != null && !value.toString().trim().isEmpty() }
}

def localCredentialsFile = new File(projectRoot, 'credentials.json')
if (!hasCompleteReleaseCredentials() && localCredentialsFile.isFile()) {
    def localCredentials = new groovy.json.JsonSlurper().parse(localCredentialsFile)
    def localKeystore = localCredentials?.android?.keystore
    releaseStoreFile = localKeystore?.keystorePath
    releaseStorePassword = localKeystore?.keystorePassword
    releaseKeyAlias = localKeystore?.keyAlias
    releaseKeyPassword = localKeystore?.keyPassword
}

def releaseSigningConfigured = hasCompleteReleaseCredentials()
if (releaseSigningConfigured) {
    def configuredStoreFile = new File(releaseStoreFile.toString())
    releaseStoreFile = configuredStoreFile.isAbsolute()
        ? configuredStoreFile.absolutePath
        : new File(projectRoot, releaseStoreFile.toString()).absolutePath
}
def releaseTaskRequested = gradle.startParameter.taskNames.any { taskName ->
    taskName.toLowerCase().contains('release')
}

if (releaseTaskRequested && !releaseSigningConfigured) {
    throw new GradleException(
        'Assinatura release ausente. Baixe o credentials.json pelo EAS ou configure ' +
        'REUNION_UPLOAD_STORE_FILE, REUNION_UPLOAD_STORE_PASSWORD, ' +
        'REUNION_UPLOAD_KEY_ALIAS e REUNION_UPLOAD_KEY_PASSWORD.'
    )
}
if (releaseTaskRequested && !file(releaseStoreFile).isFile()) {
    throw new GradleException('O keystore indicado para a assinatura release nao foi encontrado.')
}
`;

const releaseSigningConfigBlock = `
        release {
            if (releaseSigningConfigured) {
                storeFile file(releaseStoreFile)
                storePassword releaseStorePassword
                keyAlias releaseKeyAlias
                keyPassword releaseKeyPassword
            }
        }
`;

function applyReleaseSigning(buildGradle) {
  if (buildGradle.includes(SIGNING_ENV_MARKER)) return buildGradle;

  const projectRootAnchor = 'def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()';
  const debugSigningEnd = "            keyPassword 'android'\n        }\n";
  if (!buildGradle.includes(projectRootAnchor) || !buildGradle.includes(debugSigningEnd)) {
    throw new Error('Não foi possível localizar a estrutura esperada do build.gradle Android.');
  }

  let result = buildGradle.replace(projectRootAnchor, `${projectRootAnchor}\n${signingEnvironmentBlock}`);
  result = result.replace(debugSigningEnd, `${debugSigningEnd}${releaseSigningConfigBlock}`);

  const releaseDebugSigning = /(\brelease\s*\{\s*(?:\/\/[^\n]*\s*)*)signingConfig signingConfigs\.debug/;
  if (!releaseDebugSigning.test(result)) {
    throw new Error('Não foi possível substituir a assinatura debug do build release.');
  }
  return result.replace(releaseDebugSigning, '$1signingConfig signingConfigs.release');
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('A assinatura local suporta somente build.gradle em Groovy.');
    }
    gradleConfig.modResults.contents = applyReleaseSigning(gradleConfig.modResults.contents);
    return gradleConfig;
  });
};

module.exports.applyReleaseSigning = applyReleaseSigning;
