import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  fallback: (error: Error, reset: () => void) => ReactNode
  children: ReactNode
}

/** Keeps a rendering bug from taking down more than it has to (design §12.7). */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Browser console only for now; design-only: report it through the browser telemetry endpoint.
    console.error('Render error', error, info.componentStack)
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error, () => this.setState({ error: null })) : this.props.children
  }
}
