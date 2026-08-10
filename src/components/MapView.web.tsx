import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';

type MapViewPlaceholderProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

const MapView = ({ style }: MapViewPlaceholderProps) => (
  <View style={[style, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#e5e7eb' }]}>
    <Text>Mapa não suportado na Web</Text>
  </View>
);

const Marker = () => null;
const Callout = () => null;
const PROVIDER_GOOGLE = 'google';
const PROVIDER_DEFAULT = 'default';

export { MapView as default, Marker, Callout, PROVIDER_GOOGLE, PROVIDER_DEFAULT };
