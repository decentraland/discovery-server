#!/bin/bash

# Test SQS Integration Script
# Sends a test message to the LocalStack SQS queue

set -e

# Default values
ENDPOINT_URL="${AWS_SQS_ENDPOINT:-http://localhost:4566}"
QUEUE_URL="${AWS_SQS_QUEUE_URL:-http://localhost:4566/000000000000/places_test}"

# Default test data
DEFAULT_ENTITY_ID="bafkreiabc123"
DEFAULT_CONTENT_SERVER_URL="https://peer.decentraland.org"

# Parse command line arguments
ENTITY_ID="${1:-$DEFAULT_ENTITY_ID}"
CONTENT_SERVER_URL="${2:-$DEFAULT_CONTENT_SERVER_URL}"

# Build message body
MESSAGE_BODY=$(cat <<EOF
{
  "entityId": "$ENTITY_ID",
  "contentServerUrl": "$CONTENT_SERVER_URL"
}
EOF
)

echo "📤 Sending test message to SQS..."
echo "   Endpoint: $ENDPOINT_URL"
echo "   Queue: $QUEUE_URL"
echo "   Message:"
echo "$MESSAGE_BODY" | sed 's/^/     /'
echo ""

# Send message to SQS
aws --endpoint-url="$ENDPOINT_URL" sqs send-message \
  --queue-url "$QUEUE_URL" \
  --message-body "$MESSAGE_BODY"

echo ""
echo "✅ Message sent successfully!"

