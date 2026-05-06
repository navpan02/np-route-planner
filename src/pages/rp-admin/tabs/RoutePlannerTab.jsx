import { lazy, Suspense, Component } from 'react';

const RoutePlanner = lazy(() => import('../../RoutePlanner'));

class PlannerErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 max-w-2xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
            <p className="font-bold text-red-800 mb-2">Route Planner crashed</p>
            <pre className="text-red-700 text-xs whitespace-pre-wrap overflow-auto max-h-48">{this.state.error?.stack ?? this.state.error?.message}</pre>
            <button
              className="mt-4 px-4 py-2 bg-red-600 text-white text-sm rounded-lg"
              onClick={() => this.setState({ error: null })}
            >Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function RoutePlannerTab({ session }) {
  return (
    <PlannerErrorBoundary>
      <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading route planner…</div>}>
        <RoutePlanner portalSession={session} portalClient={session?.portalClient} />
      </Suspense>
    </PlannerErrorBoundary>
  );
}
