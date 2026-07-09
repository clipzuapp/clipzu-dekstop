import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  /** Label shown in the fallback UI to help users identify which panel crashed */
  label?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * ErrorBoundary — catches React render errors in child components and displays
 * a non-fatal fallback UI instead of a white screen. Used around critical panels
 * (Preview, Timeline) so a crash in one panel doesn't take down the entire app.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ErrorBoundary] ${this.props.label ?? 'Component'} crashed:`,
      error.message,
      info.componentStack
    )
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-gray-300 p-4 gap-3">
          <div className="text-red-400 text-sm font-semibold">
            {this.props.label ?? 'Component'} encountered an error
          </div>
          <div className="text-xs text-gray-500 max-w-xs text-center">
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <button
            onClick={this.handleRetry}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
