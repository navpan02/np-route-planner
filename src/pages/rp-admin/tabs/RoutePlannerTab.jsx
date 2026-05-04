import { lazy, Suspense } from 'react';

const RoutePlanner = lazy(() => import('../../RoutePlanner'));

export default function RoutePlannerTab({ session }) {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading route planner…</div>}>
      <RoutePlanner portalSession={session} portalClient={session?.portalClient} />
    </Suspense>
  );
}
