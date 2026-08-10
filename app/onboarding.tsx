import { Redirect } from 'expo-router';

// Mantém links antigos compatíveis, sem duplicar o fluxo de onboarding.
export default function LegacyOnboardingRedirect() {
    return <Redirect href="/(auth)/onboarding" />;
}
