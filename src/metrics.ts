import { validateMetricsDeclaration } from '@dcl/metrics'
import { getDefaultHttpMetrics } from '@dcl/http-server'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { IMetricsComponent } from '@well-known-components/interfaces'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  job_execution_duration_seconds: {
    type: IMetricsComponent.HistogramType,
    help: 'Duration of scheduled job executions in seconds',
    labelNames: ['job']
  },
  job_execution_total: {
    type: IMetricsComponent.CounterType,
    help: 'Total scheduled job executions by result',
    labelNames: ['job', 'result']
  },
  sqs_messages_processed_total: {
    type: IMetricsComponent.CounterType,
    help: 'Total SQS deployment messages processed by result',
    labelNames: ['result']
  },
  notifications_published_total: {
    type: IMetricsComponent.CounterType,
    help: 'Total notifications published to SNS by type',
    labelNames: ['type']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
