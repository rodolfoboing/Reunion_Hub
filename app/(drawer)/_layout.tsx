import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Drawer } from 'expo-router/drawer';

/**
 * O Drawer existe apenas como CONTÊINER das rotas autenticadas — `(tabs)`,
 * `notifications`, `profile`, e os redirecionamentos legados `map`/`my-events`.
 * A gaveta em si está desativada: nenhum ponto do app a abre (não há botão de
 * menu nem `openDrawer`), e o gesto de borda foi fechado porque dava numa lista
 * que o usuário nunca deveria ver.
 *
 * Por isso não há mais `drawerContent`, rótulo, ícone ou cor de item aqui: era
 * tudo configuração de uma lista inalcançável. O `CustomDrawerContent` foi
 * removido pelo mesmo motivo. As telas se registram sozinhas pelos arquivos da
 * pasta, e cada uma define seu próprio cabeçalho.
 *
 * `GestureHandlerRootView` fica: é requisito do próprio Drawer.
 */
export default function DrawerLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer screenOptions={{ headerShown: false, swipeEnabled: false }} />
    </GestureHandlerRootView>
  );
}
