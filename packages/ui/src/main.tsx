import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import { theme } from './theme/theme';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './routes';
import { resolveUiFeatures, UiFeaturesContext } from './lib/uiFeatures';

const features = resolveUiFeatures(
  window.__INTERLOCK_CONFIG__,
  window.location.search,
);

const router = createBrowserRouter(routes);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <UiFeaturesContext.Provider value={features}>
        <RouterProvider router={router} />
      </UiFeaturesContext.Provider>
    </MantineProvider>
  </StrictMode>,
);
