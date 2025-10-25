#!/bin/bash

# LocalStack Initialization Hook
# This script runs automatically when LocalStack becomes ready in docker-compose.
# LocalStack automatically executes all scripts in /etc/localstack/init/ready.d/
#
# The volume mapping in docker-compose.yml:
#   - ./localstack-init:/etc/localstack/init/ready.d
#
# For more info: https://docs.localstack.cloud/aws/capabilities/config/initialization-hooks/

set -e

# Set AWS credentials (required for awslocal commands)
export AWS_ACCESS_KEY_ID=000000000000
export AWS_SECRET_ACCESS_KEY=000000000000

echo "🚀 LocalStack Init Hook: Creating resources..."

# Create SQS queue
QUEUE_NAME="places_test"
echo "   Creating SQS queue: $QUEUE_NAME"

awslocal sqs create-queue --queue-name "$QUEUE_NAME"

echo "✅ LocalStack initialization complete!"

