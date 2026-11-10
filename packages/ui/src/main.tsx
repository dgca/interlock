import { DesignSystemProvider } from './design-system';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@xyflow/react/dist/style.css';
import './styles.css';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './routes';
import { resolveUiFeatures, UiFeaturesContext } from './lib/uiFeatures';
import { removeLegacyManualClaims } from './features/runs/manualClaims';

removeLegacyManualClaims();

const features = resolveUiFeatures(
  window.__INTERLOCK_CONFIG__,
  window.location.search,
);

const router = createBrowserRouter(routes);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesignSystemProvider>
      <UiFeaturesContext.Provider value={features}>
        <RouterProvider router={router} />
      </UiFeaturesContext.Provider>
    </DesignSystemProvider>
  </StrictMode>,
);
