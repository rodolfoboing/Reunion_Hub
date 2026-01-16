import { LinearGradient } from 'expo-linear-gradient';
import { Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

interface StyledButtonProps {
    title: string;
    onPress: () => void;
    isLoading?: boolean;
    colors?: [string, string, ...string[]];
}

export function StyledButton({ title, onPress, isLoading, colors = ['#6366f1', '#a855f7'] }: StyledButtonProps) {
    return (
        <TouchableOpacity onPress={onPress} disabled={isLoading} style={styles.container}>
            <LinearGradient
                colors={colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradient}
            >
                {isLoading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.text}>{title}</Text>
                )}
            </LinearGradient>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 12,
        overflow: 'hidden',
        marginTop: 10,
        width: '100%',
    },
    gradient: {
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
        letterSpacing: 0.5,
    },
});
