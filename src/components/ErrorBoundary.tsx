import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      const ar = document.documentElement.dir === 'rtl';
      return (
        <div className="min-h-screen flex items-center justify-center bg-ui-page p-4">
          <div className="text-center max-w-md bg-ui-surface rounded-2xl shadow-ui-xl p-8 border border-ui-border">
            <div className="w-16 h-16 rounded-full bg-ui-danger-soft flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-ui-danger" />
            </div>
            <h2 className="text-xl font-bold text-ui-text mb-2">{ar ? 'حدث خطأ' : 'Something went wrong'}</h2>
            <p className="text-sm text-ui-muted mb-4">{this.state.error.message}</p>
            <p className="text-xs text-ui-subtle mb-6 whitespace-pre-wrap text-start bg-ui-page p-3 rounded-xl max-h-40 overflow-auto">{this.state.error.stack}</p>
            <button onClick={() => { this.setState({ error: null }); }} className="px-6 py-2.5 bg-ui-primary hover:bg-ui-primary-hover text-ui-primary-fg font-medium rounded-xl transition-colors">
              {ar ? 'إعادة المحاولة' : 'Try again'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
