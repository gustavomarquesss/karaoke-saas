import { useRoute } from './hooks/useRoute';
import { Editor } from './pages/Editor';
import { Library } from './pages/Library';
import { Player } from './pages/Player';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'play':
      return <Player key={route.id} id={route.id} />;
    case 'edit':
      return <Editor key={route.id} id={route.id} />;
    default:
      return <Library />;
  }
}
