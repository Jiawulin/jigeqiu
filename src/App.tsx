import { lazy, Suspense } from 'react';
import PrototypeApp from './PrototypeApp';
import { LocalDataBoundary } from './components/common/LocalDataBoundary';
import { BrowserGestureBoundary } from './components/common/BrowserGestureBoundary';
import { WorkbenchRecoveryBoundary } from './components/common/WorkbenchRecoveryBoundary';

const ImportWorkspace = lazy(() => import('./ImportWorkspace'));

export default function App() {
  // Keep the original desktop as the default while integrating one feature at a time.
  if (new URLSearchParams(window.location.search).get('workspace') === 'import') {
    return <><BrowserGestureBoundary /><Suspense fallback={<p role="status">正在加载…</p>}><ImportWorkspace /></Suspense></>;
  }
  return <><BrowserGestureBoundary /><LocalDataBoundary><WorkbenchRecoveryBoundary><PrototypeApp /></WorkbenchRecoveryBoundary></LocalDataBoundary></>;
}
