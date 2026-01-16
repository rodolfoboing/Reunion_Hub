import { View, Text, Image, StyleSheet } from 'react-native';
import { DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';

export default function CustomDrawerContent(props: any) {
    return (
        <DrawerContentScrollView {...props} contentContainerStyle={styles.container}>
            <View style={styles.header}>
                <Image
                    source={require('../../assets/images/Whisk_Reunion_Hub_Logo.png')}
                    style={styles.logo}
                    resizeMode="contain"
                />
                <Text style={styles.appName}>Reunion Hub</Text>
            </View>
            <View style={styles.itemsContainer}>
                <DrawerItemList {...props} />
            </View>
        </DrawerContentScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: 0,
    },
    header: {
        height: 180,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        marginBottom: 10
    },
    logo: {
        width: 100,
        height: 100,
        marginBottom: 10
    },
    appName: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937'
    },
    itemsContainer: {
        flex: 1,
        backgroundColor: '#fff'
    }
});
